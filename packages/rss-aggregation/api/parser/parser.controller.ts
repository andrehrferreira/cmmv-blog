import {
    Controller, Get, Param,
    Query
} from "@cmmv/http";

import {
    Auth
} from "@cmmv/auth";

import {
    ParserService
} from "./parser.service";

@Controller("feed/parser")
export class ParserController {
    constructor(private readonly parserService: ParserService){}

    @Get("parseURL")
    @Auth({ rootOnly: true })
    async parseURL(@Query("url") url: string) {
        const urlDecoded = decodeURIComponent(url);
        return await this.parserService.parseURL(urlDecoded);
    }

    @Get("parseContent/:parserId")
    @Auth({ rootOnly: true })
    async parseContent(@Param("parserId") parserId: string, @Query("url") url: string) {
        const urlDecoded = decodeURIComponent(url);
        return await this.parserService.parseContent(parserId, urlDecoded);
    }

    @Get("parseContentAll")
    @Auth({ rootOnly: true })
    async parseContentAll(@Query("url") url: string) {
        const urlDecoded = decodeURIComponent(url);
        return await this.parserService.parseContent(null, urlDecoded);
    }
}
