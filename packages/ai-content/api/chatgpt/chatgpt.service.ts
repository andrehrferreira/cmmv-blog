import { Service, Config } from "@cmmv/core";

@Service()
export class ChatGPTService {
    async generateContent(prompt: string) : Promise<string> {
        const openaiApiKey = Config.get("blog.openaiApiKey");

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey || ''}`
            },
            body: JSON.stringify({
                model: "gpt-4-mini",
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 8000
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to generate AI content: ${response.statusText}`);
        }

        const openaiResponse = await response.json();
        const generatedText = openaiResponse.choices?.[0]?.message?.content;

        if (!generatedText)
            throw new Error('No content generated by ChatGPT');

        return generatedText;
    }
}
