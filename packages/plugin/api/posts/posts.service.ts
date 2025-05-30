import {
    Service, EventsService,
    Logger, Config, Cron,
    CronExpression,
    Application
} from "@cmmv/core";

import {
    Repository, In,
    MoreThanOrEqual
} from "@cmmv/repository";

import {
    IPostMetadata,
    IDraftPost
} from "./posts.interface";

import { slugify } from "../utils/extra.utils";
import { MediasService } from "../medias/medias.service";
//@ts-ignore
import { AIContentService } from "@cmmv/ai-content";
import { CDNService } from "../cdn/cdn.service";
import { IndexingService } from "../indexing/indexing.service";

@Service('blog_posts_public')
export class PostsPublicService {
    private readonly logger = new Logger("PostsPublicService");

    constructor(
        private readonly mediasService: MediasService,
        private readonly eventsService: EventsService,
        private readonly aiContentService: AIContentService,
        private readonly cdnService: CDNService,
        private readonly indexingService: IndexingService
    ){}

    @Cron(CronExpression.EVERY_30_MINUTES)
    async handleCronJobs() {
        return await this.processCrons.call(this);
    }

    /**
     * Get all posts
     * @param {any} queries - The queries
     * @param {any} req - The request
     * @returns {Promise<any>}
     */
    async getAllPosts(queries: any, req: any, admin: boolean = false) {
        const PostsEntity = Repository.getEntity("PostsEntity");
        const ProfilesEntity = Repository.getEntity("ProfilesEntity");
        const CategoriesEntity = Repository.getEntity("CategoriesEntity");

        delete queries.t;

        if(queries.limit > 100)
            throw new Error("The limit must be less than 100");

        const sortFields = ["publishedAt", "createdAt", "updatedAt", "comments", "views"];

        if(queries.sortBy && !sortFields.includes(queries.sortBy))
            throw new Error("The sortBy must be one of the following: " + sortFields.join(", "));

        if(queries.sort && !["ASC", "DESC"].includes(queries.sort.toUpperCase()) && queries.status !== undefined)
            throw new Error("The sort must be one of the following: ASC, DESC");

        if(queries.status !== "published" && queries.status !== "" && queries.status !== undefined && !admin)
            throw new Error("The status must be one of the following: published");

        let sortOptions = {
            sortBy: "publishedAt",
            sort: "DESC"
        };

        if (!queries.status || queries.status === "") {
            sortOptions = {
                sortBy: "status",
                sort: "ASC"
            };
        }

        const posts = await Repository.findAll(PostsEntity, {
            ...queries,
            type: "post",
            deleted: false
        }, [], {
            select: [
                "id", "title", "slug", "content", "status", "autoPublishAt",
                "authors", "author", "categories", "featureImage", "publishedAt",
                "updatedAt", "createdAt", "comments", "views"
            ],
            order: {
                publishedAt: "DESC",
                status: "ASC",
                autoPublishAt: "DESC",

            }
        });

        let authors: any[] = [];
        let categories: any[] = [];

        if(posts){
            let userIdsIn: string[] = [];
            let categoryIdsIn: string[] = [];

            for (const post of posts.data) {
                if (post.status === 'cron' && post.autoPublishAt)
                    post.scheduledPublishDate = new Date(post.autoPublishAt).toLocaleString();

                userIdsIn = [...userIdsIn, ...post.authors];

                if(post.author !== "current-user-id")
                    userIdsIn.push(post.author);

                if(post.categories && post.categories.length > 0){
                    categoryIdsIn = [...categoryIdsIn, ...post.categories];

                    const categoriesData = await Repository.findAll(CategoriesEntity, {
                        id: In(post.categories),
                        limit: 100
                    }, [], {
                        select: [ "id", "name", "slug", "description" ]
                    });

                    post.categories = (categoriesData) ? categoriesData.data : [];
                }

                if(post.featureImage){
                    post.featureImage = await this.mediasService.getImageUrl(
                        post.featureImage,
                        "webp",
                        1200,
                        post.featureImageAlt,
                        post.featureImageCaption
                    );
                }
            }

            //@ts-ignore
            const usersIn = [...new Set(userIdsIn)];
            //@ts-ignore
            const categoryIn = [...new Set(categoryIdsIn)];

            const authorsData = await Repository.findAll(ProfilesEntity, {
                user: In(usersIn),
                limit: 100
            }, [], {
                select: [
                    'id', 'user', 'name', 'slug', 'image', 'coverImage',
                    'bio', 'website', 'location', 'facebook', 'twitter', 'locale',
                    'visibility', 'metaTitle', 'metaDescription', 'lastSeen',
                    'commentNotifications', 'mentionNotifications', 'recommendationNotifications'
                ]
            });

            if(authorsData){
                for(const author of authorsData.data){
                    author.image = await this.mediasService.getImageUrl(
                        author.image,
                        "webp",
                        128,
                        author.name,
                        author.name
                    );

                    author.coverImage = await this.mediasService.getImageUrl(
                        author.coverImage,
                        "webp",
                        1024,
                        author.name,
                        author.name
                    );
                }
            }

            authors = (authorsData) ? authorsData.data : [];

            const categoriesData = await Repository.findAll(CategoriesEntity, {
                id: In(categoryIn),
                limit: 100
            }, [], {
                select: [ "id", "name", "slug", "description" ]
            });

            categories = (categoriesData) ? categoriesData.data : [];
        }

        return {
            posts: (posts) ? posts.data : [],
            count: (posts) ? posts.count : 0,
            pagination: (posts) ? posts.pagination : null,
            authors,
            categories
        };
    }

    /**
     * Get all pages
     * @param {any} queries - The queries
     * @param {any} req - The request
     * @returns {Promise<any>}
     */
    async getAllPages(queries: any, req: any) {
        const PostsEntity = Repository.getEntity("PostsEntity");
        const ProfilesEntity = Repository.getEntity("ProfilesEntity");

        delete queries.t;

        if(queries.limit > 100)
            throw new Error("The limit must be less than 100");

        if(queries.status !== "published" && queries.status !== "" && queries.status !== undefined)
            throw new Error("The status must be one of the following: published");

        const posts = await Repository.findAll(PostsEntity, {
            ...queries,
            type: "page",
            deleted: false
        }, [], {
            select: [
                "id", "title", "slug", "content", "status", "autoPublishAt",
                "authors", "author", "categories", "featureImage", "publishedAt",
                "updatedAt", "createdAt"
            ]
        });

        let authors: any[] = [];

        if(posts){
            let userIdsIn: string[] = [];

            for(const post of posts.data){
                if(post.author !== "current-user-id")
                    userIdsIn.push(post.author);
            }

            //@ts-ignore
            const usersIn = [...new Set(userIdsIn)];

            const authorsData = await Repository.findAll(ProfilesEntity, {
                user: In(usersIn),
                limit: 100
            }, [], {
                select: [
                    'id', 'user', 'name', 'slug', 'image', 'coverImage',
                    'bio', 'website', 'location', 'facebook', 'twitter', 'locale',
                    'visibility', 'metaTitle', 'metaDescription', 'lastSeen',
                    'commentNotifications', 'mentionNotifications', 'recommendationNotifications'
                ]
            });

            authors = (authorsData) ? authorsData.data : [];
        }

        return {
            posts: (posts) ? posts.data : [],
            count: (posts) ? posts.count : 0,
            pagination: (posts) ? posts.pagination : null,
            authors
        };
    }

    /**
     * Get all tags
     * @returns {Promise<any>}
     */
    async getTags(queries: any) {
        const TagsEntity = Repository.getEntity("TagsEntity");

        if(queries.limit > 100)
            throw new Error("The limit must be less than 100");

        const tags = await Repository.findAll(TagsEntity, {
            ...queries,
            limit: 100
        }, [], {
            select: [ "id", "name", "slug", "description", "postCount" ]
        });

        return (tags) ? JSON.stringify(tags.data) : [];
    }

    /**
     * Draft a post
     * @param {IDraftPost} data.post - The post data
     * @param {IPostMetadata} data.meta - The post metadata
     * @returns {Promise<any>}
     */
    async savePost(data: {
        post: IDraftPost,
        meta: IPostMetadata
    }, user: any) {
        const PostsEntity = Repository.getEntity("PostsEntity");
        const MetaEntity = Repository.getEntity("MetaEntity");

        if(data.post.content.length < 100)
            throw new Error("The content must be at least 100 characters");

        if(data.post.title.length < 3)
            throw new Error("The title must be at least 3 characters");

        if(data.post.title.length > 100)
            throw new Error("The title must be less than 100 characters");

        if(data.post.slug.length < 3)
            throw new Error("The slug must be at least 3 characters");

        if(data.post.slug.length > 100)
            throw new Error("The slug must be less than 100 characters");

        if (data.post.content) {
            data.post.content = data.post.content
                .replace(/<div class="iframe-actions">.*?<\/div>/g, '')
                .replace(/<div class="tweet-embed-actions">.*?<\/div>/g, '')
                .replace(/<div class="reddit-embed-actions">.*?<\/div>/g, '');
        }

        const UserEntity = Repository.getEntity("UserEntity");
        const userData = await Repository.findOne(UserEntity, {});

        if(!userData)
            throw new Error("User not found");

        user = userData;

        if(data.post && data.post.id && typeof data.post.id === "string") {
            if(data.post.meta)
                delete data.post.meta;

            if(data.post.authors){
                const authors = [...data.post.authors];
                data.post.authors = [];

                for(const author of authors){
                    if(typeof author === "string")
                        data.post.authors.push(author);
                    else //@ts-ignore
                        data.post.authors.push(author.user);
                }
            }

            data.post.type = "post";

            if(data.post.author === "current-user-id")
                data.post.author = user.id;

            if(data.post.author !== "current-user-id")
                data.post.authors.push(data.post.author);

            const post: any = await Repository.updateOne(
                PostsEntity, Repository.queryBuilder({ id: data.post.id }), data.post
            );

            if(post){
                await Repository.updateOne(MetaEntity, {
                    post: data.post.id
                }, data.meta);
            }

            if(data.post.status === "published" && data.post.pushNotification === true)
                await this.eventsService.emit("posts.published", data.post);

            if(data.post.status === "published") {
                const siteUrl = Config.get("blog.url") || "";
                this.logger.log(`Clearing CDN cache for homepage after publishing post ${data.post.id}`);

                try {
                    await this.cdnService.clearCDNCache([siteUrl, `${siteUrl}/`]);
                } catch (error) {
                    this.logger.error(`Error clearing CDN cache: ${error}`);
                }
            }

            if(data.post.status === "published")
                await this.indexingService.updateIndexing(`${Config.get("blog.url")}/post/${data.post.slug}`);

            await this.upsertTags(data.post.tags);
            await this.recalculateCategories();

            return { result: true };
        }
        else {
            data.post.author = user.id;
            data.post.type = "post";

            if(!data.post.authors || data.post.authors.length === 1)
                data.post.authors = [user.id];

            const post: any = await Repository.insert(PostsEntity, data.post);

            if(post){
                data.meta.post = post.data.id;
                await Repository.insert(MetaEntity, data.meta);

                if(data.post.status === "published") {
                    const siteUrl = Config.get("blog.url") || "";
                    this.logger.log(`Clearing CDN cache for homepage after publishing new post ${post.data.id}`);
                    try {
                        await this.cdnService.clearCDNCache([siteUrl, `${siteUrl}/`]);
                    } catch (error) {
                        this.logger.error(`Error clearing CDN cache: ${error}`);
                    }
                }
            }

            if(data.post.status === "published")
                await this.indexingService.updateIndexing(`${Config.get("blog.url")}/post/${data.post.slug}`);

            await this.upsertTags(data.post.tags);
            await this.recalculateCategories();

            return post.data;
        }
    }

    /**
     * Save a page
     * @param {IDraftPost} data.post - The post data
     * @param {IPostMetadata} data.meta - The post metadata
     * @returns {Promise<any>}
     */
    async savePage(data: {
        post: IDraftPost,
        meta: IPostMetadata
    }, user: any) {
        const PostsEntity = Repository.getEntity("PostsEntity");
        const MetaEntity = Repository.getEntity("MetaEntity");

        if(data.post.content.length < 100)
            throw new Error("The content must be at least 100 characters");

        if(data.post.title.length < 3)
            throw new Error("The title must be at least 3 characters");

        if(data.post.title.length > 100)
            throw new Error("The title must be less than 100 characters");

        if(data.post.slug.length < 3)
            throw new Error("The slug must be at least 3 characters");

        if(data.post.slug.length > 100)
            throw new Error("The slug must be less than 100 characters");

        if (data.post.content) {
            data.post.content = data.post.content
                .replace(/<div class="iframe-actions">.*?<\/div>/g, '')
                .replace(/<div class="tweet-embed-actions">.*?<\/div>/g, '')
                .replace(/<div class="reddit-embed-actions">.*?<\/div>/g, '');
        }

        if(data.post && data.post.id && typeof data.post.id === "string") {
            data.post.type = "page";

            const page: any = await Repository.updateOne(
                PostsEntity, Repository.queryBuilder({ id: data.post.id }), data.post
            );

            if(page){
                await Repository.updateOne(MetaEntity, {
                    post: data.post.id
                }, data.meta);
            }

            if(data.post.status === "published")
                await this.indexingService.updateIndexing(`${Config.get("blog.url")}/page/${data.post.slug}`);

            return { result: true };
        }
        else {
            data.post.author = user.id;
            data.post.authors = [user.id];
            data.post.type = "page";

            const page: any = await Repository.insert(PostsEntity, data.post);

            if(page){
                data.meta.post = page.data.id;
                await Repository.insert(MetaEntity, data.meta);
            }

            if(data.post.status === "published")
                await this.indexingService.updateIndexing(`${Config.get("blog.url")}/page/${data.post.slug}`);

            return page.data;
        }
    }

    /**
     * Get a post by slug
     * @param {string} slug - The slug of the post
     * @returns {Promise<any>}
     */
    async getPostBySlug(slug: string) {
        const PostsEntity = Repository.getEntity("PostsEntity");
        const post: any = await Repository.findOne(PostsEntity, Repository.queryBuilder({
            slug,
            type: "post",
            status: "published"
        }));

        if(!post)
            throw new Error("Post not found");

        return this.getPostById(post.id);
    }

    /**
     * Get a post id by slug
     * @param {string} slug - The slug of the post
     * @returns {Promise<any>}
     */
    async getPostIdBySlug(slug: string) {
        const PostsEntity = Repository.getEntity("PostsEntity");
        const post: any = await Repository.findOne(PostsEntity, Repository.queryBuilder({
            slug,
            type: "post",
        }), {
            select: [ "id" ]
        });

        if(!post)
            return null;

        return post.id;
    }

    /**
     * Get a page by slug
     * @param {string} slug - The slug of the page
     * @returns {Promise<any>}
     */
    async getPageBySlug(slug: string) {
        const PostsEntity = Repository.getEntity("PostsEntity");

        const page: any = await Repository.findOne(PostsEntity, Repository.queryBuilder({
            slug,
            type: "page",
            status: "published"
        }));

        if(!page)
            throw new Error("Page not found");

        return this.getPageById(page.id);
    }

    /**
     * Get a post by id
     * @param {string} id - The id of the post
     * @returns {Promise<any>}
     */
    async getPostById(id: string) {
        const PostsEntity = Repository.getEntity("PostsEntity");
        const ProfilesEntity = Repository.getEntity("ProfilesEntity");
        const CategoriesEntity = Repository.getEntity("CategoriesEntity");
        const MetaEntity = Repository.getEntity("MetaEntity");
        const TagsEntity = Repository.getEntity("TagsEntity");

        const post: any = await Repository.findOne(PostsEntity, Repository.queryBuilder({
            id,
            type: "post"
        }), {
            select: [
                'id', 'title', 'slug', 'content', 'status', 'autoPublishAt', 'authors', 'author',
                'canonicalUrl', 'categories', 'codeInjectionBody', 'codeInjectionHead', 'excerpt',
                'featureImage', 'featureImageAlt', 'featureImageCaption', 'featured', 'image',
                'metaDescription', 'metaKeywords', 'metaTitle',
                'publishedAt', 'tags', 'type', 'visibility', 'createdAt', 'updatedAt'
            ]
        });

        if(post){
            if(post.featureImage){
                post.featureImage = await this.mediasService.getImageUrl(
                    post.featureImage,
                    "webp",
                    1200,
                    post.featureImageAlt,
                    post.featureImageCaption
                );
            }

            const meta: any = await Repository.findOne(MetaEntity, Repository.queryBuilder({
                post: post.id
            }), {
                select: [
                    'id', 'post', 'metaDescription', 'metaTitle',
                    'ogDescription', 'ogImage', 'ogTitle', 'twitterDescription', 'twitterImage',
                    'twitterTitle'
                ]
            });

            post.meta = meta;

            let userIdsIn = [...post.authors];
            let categoryIdsIn = (post.categories && post.categories.length > 0) ? [...post.categories] : [];

            //@ts-ignore
            const usersIn = [...new Set(userIdsIn)];
            //@ts-ignore
            const categoryIn = [...new Set(categoryIdsIn)];

            //Authors
            const authorsData = await Repository.findAll(ProfilesEntity, {
                user: In(usersIn),
                limit: 100
            }, [], {
                select: [
                    'id', 'user', 'name', 'slug', 'image', 'coverImage',
                    'bio', 'website', 'location', 'facebook', 'twitter',
                    'instagram', 'linkedin', 'github', 'locale',
                    'visibility', 'metaTitle', 'metaDescription'
                ]
            });

            post.authors = (authorsData) ? authorsData.data : [];

            for(let key in post.authors){
                post.authors[key].image = await this.mediasService.getImageUrl(
                    post.authors[key].image,
                    "webp",
                    128,
                    post.authors[key].name,
                    post.authors[key].name
                );

                post.authors[key].coverImage = await this.mediasService.getImageUrl(
                    post.authors[key].coverImage,
                    "webp",
                    1024,
                    post.authors[key].name,
                    post.authors[key].name
                );
            }

            if(categoryIn.length > 0){
                const categoriesData = await Repository.findAll(CategoriesEntity, {
                    id: In(categoryIn),
                    limit: 100
                }, [], {
                    select: [ "id", "name", "slug", "description" ]
                });

                post.categories = (categoriesData) ? categoriesData.data : [];
            }

            //Tags
            const tagsData = await Repository.findAll(TagsEntity, {
                name: In(post.tags),
                limit: 100
            }, [], {
                select: [ "id", "name", "slug", "description" ]
            });

            post.tags = (tagsData) ? tagsData.data : [];
        }

        return JSON.stringify(post);
    }

    /**
     * Get a page by id
     * @param {string} id - The id of the page
     * @returns {Promise<any>}
     */
    async getPageById(id: string) {
        const PostsEntity = Repository.getEntity("PostsEntity");
        const ProfilesEntity = Repository.getEntity("ProfilesEntity");
        const MetaEntity = Repository.getEntity("MetaEntity");

        const page: any = await Repository.findOne(PostsEntity, Repository.queryBuilder({
            id,
            type: "page"
        }), {
            select: [
                'id', 'title', 'slug', 'content', 'status', 'autoPublishAt', 'author',
                'canonicalUrl', 'codeInjectionBody', 'codeInjectionHead', 'excerpt',
                'featureImage', 'featureImageAlt', 'featureImageCaption', 'featured', 'image',
                'metaDescription', 'metaKeywords', 'metaTitle',
                'publishedAt', 'tags', 'type', 'visibility', 'createdAt', 'updatedAt'
            ]
        });

        if(page){
            if(page.featureImage){
                page.featureImage = await this.mediasService.getImageUrl(
                    page.featureImage,
                    "webp",
                    1200,
                    page.featureImageAlt,
                    page.featureImageCaption
                );
            }

            const meta: any = await Repository.findOne(MetaEntity, Repository.queryBuilder({
                post: page.id
            }), {
                select: [
                    'id', 'post', 'metaDescription', 'metaTitle',
                    'ogDescription', 'ogImage', 'ogTitle', 'twitterDescription', 'twitterImage',
                    'twitterTitle'
                ]
            });

            page.meta = meta;
            let userIdsIn = [page.author];

            //Authors
            const authorsData = await Repository.findAll(ProfilesEntity, {
                user: In(userIdsIn),
                limit: 100
            }, [], {
                select: [
                    'id', 'user', 'name', 'slug', 'image', 'coverImage',
                    'bio', 'website', 'location', 'facebook', 'twitter', 'instagram',
                    'linkedin', 'github', 'locale', 'visibility', 'metaTitle', 'metaDescription'
                ]
            });

            page.authors = (authorsData) ? authorsData.data : [];

            for(let key in page.authors){
                page.authors[key].image = await this.mediasService.getImageUrl(
                    page.authors[key].image,
                    "webp",
                    128,
                    page.authors[key].name,
                    page.authors[key].name
                );

                page.authors[key].coverImage = await this.mediasService.getImageUrl(
                    page.authors[key].coverImage,
                    "webp",
                    1024,
                    page.authors[key].name,
                    page.authors[key].name
                );
            }
        }

        return JSON.stringify(page);
    }

    /**
     * Get posts by category
     * @param {string} categoryId - The id of the category
     * @returns {Promise<any>}
     */
    async getPostsByCategory(categoryId: string, queries: any) {
        const PostsEntity = Repository.getEntity("PostsEntity");
        const TagsEntity = Repository.getEntity("TagsEntity");

        if(queries.limit > 100)
            throw new Error("The limit must be less than 100");

        if(categoryId === undefined || categoryId === null)
            throw new Error("The categoryId is required");

        const posts = await Repository.findAll(PostsEntity, {
            searchField: 'categories',
            search: categoryId,
            limit: queries.limit || 10,
            offset: queries.offset || 0,
            status: "published",
            sortBy: "publishedAt",
            sort: "DESC",
            type: "post"
        }, [], {
            select: [
                'id', 'title', 'slug', 'content', 'status', 'autoPublishAt', 'authors', 'author',
                'canonicalUrl', 'categories', 'codeInjectionBody', 'codeInjectionHead', 'excerpt',
                'featureImage', 'featureImageAlt', 'featureImageCaption', 'featured', 'image',
                'metaDescription', 'metaKeywords', 'metaTitle',
                'publishedAt', 'tags', 'type', 'visibility', 'createdAt', 'updatedAt'
            ]
        });

        if(posts){
            for(const post of posts.data){
                post.featureImage = await this.mediasService.getImageUrl(
                    post.featureImage,
                    "webp",
                    1200,
                )

                //Tags
                const tagsData = await Repository.findAll(TagsEntity, {
                    name: In(post.tags),
                    limit: 100
                }, [], {
                    select: [ "id", "name", "slug", "description" ]
                });

                post.tags = (tagsData) ? tagsData.data : [];
            }
        }

        return posts;
    }

    /**
     * Get posts by tag slug
     * @param {string} tagSlug - The slug of the tag
     * @returns {Promise<any>}
     */
    async getPostsByTagSlug(tagSlug: string) {
        const TagsEntity = Repository.getEntity("TagsEntity");
        const tag = await Repository.findOne(TagsEntity, { slug: tagSlug }, {
            select: [ "id", "name" ]
        });

        if(!tag)
            throw new Error("Tag not found");

        return this.getPostsByTag(tag.name);
    }

    /**
     * Get posts by tag
     * @param {string} tagName
     * @returns {Promise<any>}
     */
    async getPostsByTag(tagName: string) {
        const PostsEntity = Repository.getEntity("PostsEntity");
        const TagsEntity = Repository.getEntity("TagsEntity");

        const tag = await Repository.findOne(TagsEntity, { name: tagName }, {
            select: [ "id", "name", "slug", "description", "postCount" ]
        });

        if(!tag)
            throw new Error("Tag not found");

        const posts = await Repository.findAll(PostsEntity, {
            searchField: 'tags',
            search: tagName,
            limit: 10,
            status: "published",
            sortBy: "publishedAt",
            sort: "DESC",
            type: "post"
        }, [], {
            select: [
                'id', 'title', 'slug', 'content', 'status', 'autoPublishAt', 'authors', 'author',
                'canonicalUrl', 'categories', 'codeInjectionBody', 'codeInjectionHead', 'excerpt',
                'featureImage', 'featureImageAlt', 'featureImageCaption', 'featured', 'image',
                'metaDescription', 'metaKeywords', 'metaTitle',
                'publishedAt', 'tags', 'type', 'visibility', 'createdAt', 'updatedAt'
            ]
        });

        if(posts){
            for(const post of posts.data){
                post.featureImage = await this.mediasService.getImageUrl(
                    post.featureImage,
                    "webp",
                    1200,
                )

                //Tags
                const tagsData = await Repository.findAll(TagsEntity, {
                    name: In(post.tags),
                    limit: 100
                }, [], {
                    select: [ "id", "name", "slug", "description" ]
                });

                post.tags = (tagsData) ? tagsData.data : [];
            }
        }

        return { posts: posts ? posts.data : [], tag };
    }

    /**
     * Upsert tags
     * @param tags - The tags
     */
    async upsertTags(tags: string[]) {
        const TagsEntity = Repository.getEntity("TagsEntity");

        for(const tag of tags){
            const tagStoraged = await Repository.findOne(TagsEntity, { slug: tag });

            if(tagStoraged)
                continue;

            await Repository.insert(TagsEntity, { name: tag, slug: slugify(tag) });
        }

        await this.recalculateTags();
    }

    /**
     * Recalculate tags
     * @returns {Promise<void>}
     */
    async recalculateTags() {
        const TagsEntity = Repository.getEntity("TagsEntity");
        const PostsEntity = Repository.getEntity("PostsEntity");

        const tags = await Repository.findAll(TagsEntity, {
            limit: 1000
        }, [], {
            select: [ "id", "postCount" ]
        });

        if(tags){
            for(const tag of tags.data){
                const postCount = await Repository.findAll(PostsEntity, {
                    limit: 10000,
                    searchField: 'tags',
                    search: tag.name,
                    status: "published",
                    deleted: false
                }, [], {
                    select: [ "id" ]
                });

                if(postCount){
                    await Repository.updateOne(TagsEntity, { id: tag.id }, {
                        postCount: postCount.data.length
                    });
                }
            }
        }
    }

    /**
     * Recalculate categories
     * @returns {Promise<void>}
     */
    async recalculateCategories(){
        const CategoriesEntity = Repository.getEntity("CategoriesEntity");
        const PostsEntity = Repository.getEntity("PostsEntity");

        const categories = await Repository.findAll(CategoriesEntity, {
            limit: 1000
        }, [], {
            select: [ "id" ]
        });

        if(categories){
            for(const category of categories.data){
                const postCount = await Repository.findAll(PostsEntity, {
                    limit: 10000,
                    searchField: 'categories',
                    search: category.id,
                    status: "published",
                    deleted: false
                }, [], {
                    select: [ "id" ]
                });

                if(postCount){
                    await Repository.updateOne(CategoriesEntity, { id: category.id }, {
                        postCount: postCount.data.length
                    });
                }
            }
        }
    }

    /**
     * Delete a post
     * @param {string} id - The id of the post
     * @returns {Promise<any>}
     */
    async deletePost(id: string) {
        console.log("Deleting post with ID: " + id);
        const PostsEntity = Repository.getEntity("PostsEntity");
        const MetaEntity = Repository.getEntity("MetaEntity");
        const PostsHistoryEntity = Repository.getEntity("PostsHistoryEntity");
        const CommentsEntity = Repository.getEntity("CommentsEntity");

        await Repository.delete(MetaEntity, { post: id });
        await Repository.delete(PostsHistoryEntity, { post: id });
        await Repository.delete(CommentsEntity, { post: id });

        const resultDelete = await Repository.updateOne(PostsEntity, Repository.queryBuilder({ id }), {
            deleted: true,
            deletedAt: new Date()
        });

        if(resultDelete){
            await this.recalculateTags();
            await this.recalculateCategories();
        }

        return { result: resultDelete };
    }

    /**
     * Get the posts most accessed in the last week
     * @returns {Promise<any>}
     */
    async getPostsMostAccessedWeek(){
        /*const AnalyticsAccessEntity = Repository.getEntity("AnalyticsAccessEntity");

        const analyticsAccess = await Repository.findAll(AnalyticsAccessEntity, {
            summarized: true,
            limit: 10000
        }, [], {
            select: ["postId"]
        });

        const postsAccess: Record<string, number> = {};

        if(analyticsAccess){
            for(const record of analyticsAccess.data){
                if(!postsAccess[record.postId])
                    postsAccess[record.postId] = 0;

                postsAccess[record.postId]++;
            }
        }*/

        const PostsEntity = Repository.getEntity("PostsEntity");

        const posts = await Repository.findAll(PostsEntity, {
            sortBy: "views",
            sort: "desc",
            limit: 10,
            publishedAt: MoreThanOrEqual(new Date().getTime() - 7 * 24 * 60 * 60 * 1000)
        }, [], {
            select: [
                "id", "title", "slug", "views", "createdAt",
                "comments", "featureImage", "publishedAt"
            ]
        });

        if(!posts)
            return [];

        for(const post of posts.data){
            post.featureImage = await this.mediasService.getImageUrl(
                post.featureImage,
                "webp",
                1200,
            );
        }

        return posts.data.map((post: any) => ({
            id: post.id,
            title: post.title,
            slug: post.slug,
            image: post.featureImage,
            createdAt: post.createdAt,
            comments: post.comments,
            views: post.views,
            publishedAt: post.publishedAt
        }));
    }

    /**
     * Generate a post from a URL by fetching content and processing with AI
     * @param url The URL to fetch content from
     * @returns Processed post content ready for frontend
     */
    async generatePostFromUrl(url: string) {
        try {
            this.logger.log(`Generating post from URL: ${url}`);

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            if (!response.ok)
                throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);

            const html = await response.text();
            const language = Config.get("blog.language");
            const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : "";
            const descriptionMatch = html.match(/<meta[^>]*name=['"]description['"][^>]*content=['"]([^'"]*)['"]/i);
            const description = descriptionMatch ? descriptionMatch[1].trim() : "";
            const ogImageMatch = html.match(/<meta[^>]*property=['"]og:image['"][^>]*content=['"]([^'"]*)['"]/i) ||
                                html.match(/<meta[^>]*content=['"]([^'"]*)['"'][^>]*property=['"]og:image['"][^>]*/i);
            const twitterImageMatch = html.match(/<meta[^>]*name=['"]twitter:image['"][^>]*content=['"]([^'"]*)['"]/i) ||
                                    html.match(/<meta[^>]*content=['"]([^'"]*)['"'][^>]*name=['"]twitter:image['"][^>]*/i);

            let content = html;
            content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
            content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
            content = content.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ");
            content = content.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ");
            content = content.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ");

            const articleMatch = content.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
            const mainMatch = content.match(/<main[^>]*>([\s\S]*?)<\/main>/i);

            if (articleMatch) {
                content = articleMatch[1];
            } else if (mainMatch) {
                content = mainMatch[1];
            }

            content = content.replace(/<[^>]*>/g, " ");
            content = content.replace(/\s+/g, " ").trim();
            const MAX_CONTENT_LENGTH = 20000;

            if (content.length > MAX_CONTENT_LENGTH)
                content = content.substring(0, MAX_CONTENT_LENGTH) + "...";

            const imgUrlRegex = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
            const potentialImages: string[] = [];
            let match;

            if (ogImageMatch && ogImageMatch[1])
                potentialImages.push(ogImageMatch[1]);

            if (twitterImageMatch && twitterImageMatch[1])
                potentialImages.push(twitterImageMatch[1]);

            while ((match = imgUrlRegex.exec(html)) !== null) {
                if (match[1].startsWith('http')) {
                    potentialImages.push(match[1]);
                } else if (match[1].startsWith('/')) {
                    try {
                        const urlObj = new URL(url);
                        potentialImages.push(`${urlObj.origin}${match[1]}`);
                    } catch (e) {
                    }
                }
            }

            let featureImage = potentialImages.length > 0 ? potentialImages[0] : null;

            const prompt = `
            You are a content creator who specializes in creating high-quality blog posts based on online articles.

            I will provide details from a web page, and your task is to create an engaging blog post based on this content by:

            1. Translating it to ${language} if needed
            2. Creating an engaging title that captures the essence of the content (keep it under 80 characters)
            3. Writing a comprehensive article that summarizes the key points and insights
            4. Adding context, background information, and your own analysis to enhance the content
            5. Preserving important links to sources and reference pages, but adding rel="noindex nofollow" attributes to all links
            6. Creating a well-structured HTML article using proper formatting:
               - Use <h2> tags for main sections (2-4 sections recommended)
               - Use <p> tags for paragraphs
               - Use <ul> and <li> tags for lists where appropriate
               - Include a concluding paragraph
               - For links, use: <a href="https://example.com" rel="noindex nofollow" target="_blank">text</a>
            7. Start with a strong introductory paragraph
            8. Suggesting 3-8 relevant tags for categorizing this content

            IMPORTANT:
            - For titles, DO NOT default to number-based formats (like "5 Ways to..." or "10 Tips for...")
            - Only use numbered titles when the content specifically warrants it (such as step-by-step guides or ranked lists)
            - Prefer descriptive, narrative or question-based titles that engage readers without relying on numbers
            - Avoid sensationalist or clickbait headlines

            For titles, prioritize these non-numbered headline formulas:

            1. The "How-To Formula":
            How to [Achieve Desired Outcome] without [Common Pain Point]

            Examples:
            - "How to Lose Weight Without Giving Up Your Favorite Foods"
            - "How to Learn a New Language Without Spending Hours Studying"
            - "How to Start Investing Without Taking Big Risks"

            2. The "Question Formula":
            [Intriguing Question That Promises an Answer]?

            Examples:
            - "Is This the Most Overlooked Feature When Buying a Smartphone?"
            - "Are You Making These Common Skincare Mistakes?"
            - "What's the Secret to Perfect Homemade Pizza Every Time?"

            3. The "Secret Formula":
            The Secret to [Achieving Desired Outcome] That [Target Audience] Don't Know About

            Examples:
            - "The Secret to Flawless Skin That Dermatologists Don't Tell You"
            - "The Secret to Perfect Sourdough Bread That Bakers Won't Share"
            - "The Secret to Finding Cheap Flights That Travel Agents Keep Hidden"

            4. The "Why Formula":
            Why [Common Belief/Practice] Is [Wrong/Ineffective] and What to Do Instead

            Examples:
            - "Why Traditional Dieting Is Flawed and What to Do Instead"
            - "Why Your Coffee Brewing Method Is Ruining Your Morning Cup"
            - "Why Most Home Security Systems Fail When You Need Them Most"

            5. The "Comparison Formula":
            [Product/Method A] vs [Product/Method B]: Which Is Better for [Desired Outcome]

            Examples:
            - "Air Fryers vs Convection Ovens: Which Is Better for Healthy Cooking"
            - "Morning Workouts vs Evening Workouts: Which Is Better for Weight Loss"
            - "Traditional Savings vs Investments: Which Is Better for Building Wealth"

            6. The "Ultimate Guide":
            The Ultimate Guide to [Topic] for [Target Audience]

            Examples:
            - "The Ultimate Guide to Home Automation for Beginners"
            - "The Ultimate Guide to Personal Finance for Young Professionals"
            - "The Ultimate Guide to Photography for Smartphone Users"

            7. The "Warning Formula":
            [Warning Sign] - [Problem] You Need to Address Now

            Examples:
            - "Warning - Your Password Security May Be Compromised Right Now"
            - "Caution - These Kitchen Habits Are Secretly Wasting Your Money"
            - "Alert - The Skincare Ingredient You Need to Stop Using Immediately"

            Only if the content absolutely requires it, you may use these number-based formats:

            8. The "List-Based Formula" (use sparingly):
            [Number] [Adjective] Ways to [Achieve Desired Outcome]

            Examples:
            - "Clever Ways to Save Money on Groceries Every Month"
            - "Surprising Ways to Increase Your Productivity at Home"
            - "Effective Ways to Improve Your Sleep Quality Tonight"

            9. The "Discover Headline Formula" (use only when comparing specific products):
            [Adjective] + [Product Type/Topic] + for [Target Intent] – [Urgency/Result]

            Examples:
            - "Powerful Bluetooth Speakers for Outdoor Parties – Up to 40% OFF Today"
            - "Best Budget Gaming Chairs for Small Spaces – Perfect Deals in July 2025"
            - "Top Noise-Canceling Headphones for Work-from-Home – Tested & Reviewed"

            Here is the web page information:

            URL: ${url}

            Title: ${title}

            Description: ${description}

            Content: ${content}

            Return the blog post in JSON format with the following fields:
            {
              "title": "your engaging blog post title",
              "content": "HTML-formatted blog post content with proper tags",
              "excerpt": "a brief 1-2 sentence summary for meta description (max 160 characters)",
              "suggestedTags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
            }
            `;

            this.logger.log("Sending content to AI for processing");
            const generatedText = await this.aiContentService.generateContent(prompt);

            if (!generatedText)
                throw new Error('No content generated by AI');

            try {
                const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
                const jsonContent = jsonMatch ? jsonMatch[0] : null;

                if (!jsonContent)
                    throw new Error('No JSON content found in AI response');

                const parsedContent = JSON.parse(jsonContent);

                if (parsedContent.title && parsedContent.title.length > 130)
                    parsedContent.title = parsedContent.title.substring(0, 127) + '...';

                if (parsedContent.excerpt && parsedContent.excerpt.length > 160)
                    parsedContent.excerpt = parsedContent.excerpt.substring(0, 157) + '...';

                const sourceAttribution = `
<p class="source-attribution mt-4 text-sm text-gray-500 italic">
    <strong>Fonte original:</strong> <a href="${url}" target="_blank" rel="noindex nofollow noopener">${new URL(url).hostname}</a>
</p>`;

                parsedContent.content = parsedContent.content + sourceAttribution;

                return {
                    originalUrl: url,
                    title: parsedContent.title,
                    content: parsedContent.content,
                    excerpt: parsedContent.excerpt || '',
                    suggestedTags: parsedContent.suggestedTags || [],
                    featureImage: featureImage,
                    slug: slugify(parsedContent.title),
                    aiProcessed: true,
                    processedAt: new Date()
                };

            } catch (parseError) {
                this.logger.error(`Failed to parse AI generated content: ${parseError}`);
                throw new Error('Failed to parse AI generated content');
            }

        } catch (error) {
            this.logger.error(`Error in generatePostFromUrl: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Process the crons for the posts
     * @returns {Promise<any>}
     */
    async processCrons(){
        const PostsEntity = Repository.getEntity("PostsEntity");
        const posts = await Repository.findAll(PostsEntity, {
            status: "cron"
        });

        if (posts) {
            for (const post of posts.data) {
                if (post.autoPublishAt && post.autoPublishAt < new Date().getTime())
                    await this.publishPost(post.id);
            }
        }
    }

    /**
     * Publish a post that was scheduled for publication
     * @param {string} id - The id of the post to publish
     * @returns {Promise<any>}
     */
    async publishPost(id: string) {
        try {
            console.log("Publishing scheduled post with ID: " + id);
            console.log(`Publishing scheduled post with ID: ${id}`);
            const PostsEntity = Repository.getEntity("PostsEntity");
            const post = await Repository.findOne(PostsEntity, { id });

            if (!post) {
                console.error(`Post with ID ${id} not found for publishing`);
                throw new Error(`Post with ID ${id} not found`);
            }

            if (post.status !== 'cron') {
                console.log(`Post with ID ${id} is not in 'cron' status, current status: ${post.status}`);
                return { result: false, message: "Post is not scheduled for publication" };
            }

            const updateData = {
                status: 'published',
                publishedAt: new Date()
            };

            await Repository.updateOne(PostsEntity, { id }, updateData);

            if (post.pushNotification === true) {
                await this.eventsService.emit("posts.published", post);
                console.log(`Push notification event emitted for post ${id}`);
            }

            const siteUrl = Config.get("blog.url") || "";
            //console.log(`Clearing CDN cache for homepage after publishing scheduled post ${id}`);

            try {
                const cdnService = Application.resolveProvider(CDNService);
                await cdnService.clearCDNCache([siteUrl, `${siteUrl}/`]);
            } catch (error) {
                console.error(`Error clearing CDN cache: ${error instanceof Error ? error.message : String(error)}`);
            }

            //console.log(`Successfully published post with ID: ${id}`);

            return {
                result: true,
                message: "Post published successfully"
            };
        } catch (error) {
            console.error(`Error publishing post with ID ${id}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
}
