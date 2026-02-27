Context caching





In a typical AI workflow, you might pass the same input tokens over and over to a model. The Gemini API offers two different caching mechanisms:

Implicit caching (automatically enabled on most Gemini models, no cost saving guarantee)
Explicit caching (can be manually enabled on most models, cost saving guarantee)
Explicit caching is useful in cases where you want to guarantee cost savings, but with some added developer work.

Implicit caching
Implicit caching is enabled by default and available for most Gemini models. We automatically pass on cost savings if your request hits caches. There is nothing you need to do in order to enable this. It is effective as of May 8th, 2025. The minimum input token count for context caching is listed in the following table for each model:

Model	Min token limit
Gemini 3 Flash Preview	1024
Gemini 3 Pro Preview	4096
Gemini 2.5 Flash	1024
Gemini 2.5 Pro	4096
To increase the chance of an implicit cache hit:

Try putting large and common contents at the beginning of your prompt
Try to send requests with similar prefix in a short amount of time
You can see the number of tokens which were cache hits in the response object's usage_metadata field.

Explicit caching
Using the Gemini API explicit caching feature, you can pass some content to the model once, cache the input tokens, and then refer to the cached tokens for subsequent requests. At certain volumes, using cached tokens is lower cost than passing in the same corpus of tokens repeatedly.

When you cache a set of tokens, you can choose how long you want the cache to exist before the tokens are automatically deleted. This caching duration is called the time to live (TTL). If not set, the TTL defaults to 1 hour. The cost for caching depends on the input token size and how long you want the tokens to persist.

This section assumes that you've installed a Gemini SDK (or have curl installed) and that you've configured an API key, as shown in the quickstart.

Generate content using a cache
Python
JavaScript
Go
REST
The following example shows how to generate content using a cached system instruction and a text file.


import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
} from "@google/genai";

const ai = new GoogleGenAI({ apiKey: "GEMINI_API_KEY" });

async function main() {
  const doc = await ai.files.upload({
    file: "path/to/file.txt",
    config: { mimeType: "text/plain" },
  });
  console.log("Uploaded file name:", doc.name);

  const modelName = "gemini-3-flash-preview";
  const cache = await ai.caches.create({
    model: modelName,
    config: {
      contents: createUserContent(createPartFromUri(doc.uri, doc.mimeType)),
      systemInstruction: "You are an expert analyzing transcripts.",
    },
  });
  console.log("Cache created:", cache);

  const response = await ai.models.generateContent({
    model: modelName,
    contents: "Please summarize this transcript",
    config: { cachedContent: cache.name },
  });
  console.log("Response text:", response.text);
}

await main();
List caches
It's not possible to retrieve or view cached content, but you can retrieve cache metadata (name, model, display_name, usage_metadata, create_time, update_time, and expire_time).

Python
JavaScript
Go
REST
To list metadata for all uploaded caches, use GoogleGenAI.caches.list():


console.log("My caches:");
const pager = await ai.caches.list({ config: { pageSize: 10 } });
let page = pager.page;
while (true) {
  for (const c of page) {
    console.log("    ", c.name);
  }
  if (!pager.hasNextPage()) break;
  page = await pager.nextPage();
}
Update a cache
You can set a new ttl or expire_time for a cache. Changing anything else about the cache isn't supported.

Python
JavaScript
Go
REST
The following example shows how to update the ttl of a cache using GoogleGenAI.caches.update().


const ttl = `${2 * 3600}s`; // 2 hours in seconds
const updatedCache = await ai.caches.update({
  name: cache.name,
  config: { ttl },
});
console.log("After update (TTL):", updatedCache);
Delete a cache
The caching service provides a delete operation for manually removing content from the cache. The following example shows how to delete a cache:

Python
JavaScript
Go
REST

await ai.caches.delete({ name: cache.name });
Explicit caching using the OpenAI library
If you're using an OpenAI library, you can enable explicit caching using the cached_content property on extra_body.

When to use explicit caching
Context caching is particularly well suited to scenarios where a substantial initial context is referenced repeatedly by shorter requests. Consider using context caching for use cases such as:

Chatbots with extensive system instructions
Repetitive analysis of lengthy video files
Recurring queries against large document sets
Frequent code repository analysis or bug fixing
How explicit caching reduces costs
Context caching is a paid feature designed to reduce cost. Billing is based on the following factors:

Cache token count: The number of input tokens cached, billed at a reduced rate when included in subsequent prompts.
Storage duration: The amount of time cached tokens are stored (TTL), billed based on the TTL duration of cached token count. There are no minimum or maximum bounds on the TTL.
Other factors: Other charges apply, such as for non-cached input tokens and output tokens.
For up-to-date pricing details, refer to the Gemini API pricing page. To learn how to count tokens, see the Token guide.

Additional considerations
Keep the following considerations in mind when using context caching:

The minimum input token count for context caching varies by model. The maximum is the same as the maximum for the given model. (For more on counting tokens, see the Token guide).
The model doesn't make any distinction between cached tokens and regular input tokens. Cached content is a prefix to the prompt.
There are no special rate or usage limits on context caching; the standard rate limits for GenerateContent apply, and token limits include cached tokens.
The number of cached tokens is returned in the usage_metadata from the create, get, and list operations of the cache service, and also in GenerateContent when using the cache.

# token count
Understand and count tokens



Gemini and other generative AI models process input and output at a granularity called a token.

For Gemini models, a token is equivalent to about 4 characters. 100 tokens is equal to about 60-80 English words.

About tokens
Tokens can be single characters like z or whole words like cat. Long words are broken up into several tokens. The set of all tokens used by the model is called the vocabulary, and the process of splitting text into tokens is called tokenization.

When billing is enabled, the cost of a call to the Gemini API is determined in part by the number of input and output tokens, so knowing how to count tokens can be helpful.



Python JavaScript Go

Count tokens
All input to and output from the Gemini API is tokenized, including text, image files, and other non-text modalities.

You can count tokens in the following ways:

Call countTokens with the input of the request.
This returns the total number of tokens in the input only. You can make this call before sending the input to the model to check the size of your requests.

Use the usageMetadata attribute on the response object after calling generate_content.
This returns the total number of tokens in both the input and the output: totalTokenCount.
It also returns the token counts of the input and output separately: promptTokenCount (input tokens) and candidatesTokenCount (output tokens). And if you are using Context caching, the cached token count will be in cachedContentTokenCount.

If you are using a thinking model like the 2.5 ones, the token used during the thinking process are returned in thoughtsTokenCount.

Count text tokens
If you call countTokens with a text-only input, it returns the token count of the text in the input only (totalTokens). You can make this call before calling generateContent to check the size of your requests.

Another option is calling generateContent and then using the usageMetadata attribute on the response object to get the following:

The separate token counts of the input (promptTokenCount), the cached content (cachedContentTokenCount) and the output (candidatesTokenCount)
The token count for the thinking process (thoughtsTokenCount)
The total number of tokens in both the input and the output (totalTokenCount)

// Make sure to include the following import:
// import {GoogleGenAI} from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const prompt = "The quick brown fox jumps over the lazy dog.";
const countTokensResponse = await ai.models.countTokens({
  model: "gemini-2.0-flash",
  contents: prompt,
});
console.log(countTokensResponse.totalTokens);

const generateResponse = await ai.models.generateContent({
  model: "gemini-2.0-flash",
  contents: prompt,
});
console.log(generateResponse.usageMetadata);

Count multi-turn (chat) tokens
If you call countTokens with the chat history, it returns the total token count of the text from each role in the chat (totalTokens).

Another option is calling sendMessage and then using the usageMetadata attribute on the response object to get the following:

The separate token counts of the input (promptTokenCount), the cached content (cachedContentTokenCount) and the output (candidatesTokenCount)
The token count for the thinking process (thoughtsTokenCount)
The total number of tokens in both the input and the output (totalTokenCount)
To understand how big your next conversational turn will be, you need to append it to the history when you call countTokens.


// Make sure to include the following import:
// import {GoogleGenAI} from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
// Initial chat history.
const history = [
  { role: "user", parts: [{ text: "Hi my name is Bob" }] },
  { role: "model", parts: [{ text: "Hi Bob!" }] },
];
const chat = ai.chats.create({
  model: "gemini-2.0-flash",
  history: history,
});

// Count tokens for the current chat history.
const countTokensResponse = await ai.models.countTokens({
  model: "gemini-2.0-flash",
  contents: chat.getHistory(),
});
console.log(countTokensResponse.totalTokens);

const chatResponse = await chat.sendMessage({
  message: "In one sentence, explain how a computer works to a young child.",
});
console.log(chatResponse.usageMetadata);

// Add an extra user message to the history.
const extraMessage = {
  role: "user",
  parts: [{ text: "What is the meaning of life?" }],
};
const combinedHistory = chat.getHistory();
combinedHistory.push(extraMessage);
const combinedCountTokensResponse = await ai.models.countTokens({
  model: "gemini-2.0-flash",
  contents: combinedHistory,
});
console.log(
  "Combined history token count:",
  combinedCountTokensResponse.totalTokens,
);

Count multimodal tokens
All input to the Gemini API is tokenized, including text, image files, and other non-text modalities. Note the following high-level key points about tokenization of multimodal input during processing by the Gemini API:

With Gemini 2.0, image inputs with both dimensions <=384 pixels are counted as 258 tokens. Images larger in one or both dimensions are cropped and scaled as needed into tiles of 768x768 pixels, each counted as 258 tokens. Prior to Gemini 2.0, images used a fixed 258 tokens.

Video and audio files are converted to tokens at the following fixed rates: video at 263 tokens per second and audio at 32 tokens per second.

Media resolutions
Gemini 3 Pro Preview introduces granular control over multimodal vision processing with the media_resolution parameter. The media_resolution parameter determines the maximum number of tokens allocated per input image or video frame. Higher resolutions improve the model's ability to read fine text or identify small details, but increase token usage and latency.

For more details about the parameter and how it can impact token calculations, see the media resolution guide.

Image files
If you call countTokens with a text-and-image input, it returns the combined token count of the text and the image in the input only (totalTokens). You can make this call before calling generateContent to check the size of your requests. You can also optionally call countTokens on the text and the file separately.

Another option is calling generateContent and then using the usageMetadata attribute on the response object to get the following:

The separate token counts of the input (promptTokenCount), the cached content (cachedContentTokenCount) and the output (candidatesTokenCount)
The token count for the thinking process (thoughtsTokenCount)
The total number of tokens in both the input and the output (totalTokenCount)
Note: You'll get the same token count if you use a file uploaded using the File API or you provide the file as inline data.
Example that uses an uploaded image from the File API:


// Make sure to include the following import:
// import {GoogleGenAI} from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const prompt = "Tell me about this image";
const organ = await ai.files.upload({
  file: path.join(media, "organ.jpg"),
  config: { mimeType: "image/jpeg" },
});

const countTokensResponse = await ai.models.countTokens({
  model: "gemini-2.0-flash",
  contents: createUserContent([
    prompt,
    createPartFromUri(organ.uri, organ.mimeType),
  ]),
});
console.log(countTokensResponse.totalTokens);

const generateResponse = await ai.models.generateContent({
  model: "gemini-2.0-flash",
  contents: createUserContent([
    prompt,
    createPartFromUri(organ.uri, organ.mimeType),
  ]),
});
console.log(generateResponse.usageMetadata);

Example that provides the image as inline data:


// Make sure to include the following import:
// import {GoogleGenAI} from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const prompt = "Tell me about this image";
const imageBuffer = fs.readFileSync(path.join(media, "organ.jpg"));

// Convert buffer to base64 string.
const imageBase64 = imageBuffer.toString("base64");

// Build contents using createUserContent and createPartFromBase64.
const contents = createUserContent([
  prompt,
  createPartFromBase64(imageBase64, "image/jpeg"),
]);

const countTokensResponse = await ai.models.countTokens({
  model: "gemini-2.0-flash",
  contents: contents,
});
console.log(countTokensResponse.totalTokens);

const generateResponse = await ai.models.generateContent({
  model: "gemini-2.0-flash",
  contents: contents,
});
console.log(generateResponse.usageMetadata);

Video or audio files
Audio and video are each converted to tokens at the following fixed rates:

Video: 263 tokens per second
Audio: 32 tokens per second
If you call countTokens with a text-and-video/audio input, it returns the combined token count of the text and the video/audio file in the input only (totalTokens). You can make this call before calling generateContent to check the size of your requests. You can also optionally call countTokens on the text and the file separately.

Another option is calling generateContent and then using the usageMetadata attribute on the response object to get the following:

The separate token counts of the input (promptTokenCount), the cached content (cachedContentTokenCount) and the output (candidatesTokenCount)
The token count for the thinking process (thoughtsTokenCount)
The total number of tokens in both the input and the output (totalTokenCount)
Note: You'll get the same token count if you use a file uploaded using the File API or you provide the file as inline data.

// Make sure to include the following import:
// import {GoogleGenAI} from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const prompt = "Tell me about this video";
let videoFile = await ai.files.upload({
  file: path.join(media, "Big_Buck_Bunny.mp4"),
  config: { mimeType: "video/mp4" },
});

// Poll until the video file is completely processed (state becomes ACTIVE).
while (!videoFile.state || videoFile.state.toString() !== "ACTIVE") {
  console.log("Processing video...");
  console.log("File state: ", videoFile.state);
  await sleep(5000);
  videoFile = await ai.files.get({ name: videoFile.name });
}

const countTokensResponse = await ai.models.countTokens({
  model: "gemini-2.0-flash",
  contents: createUserContent([
    prompt,
    createPartFromUri(videoFile.uri, videoFile.mimeType),
  ]),
});
console.log(countTokensResponse.totalTokens);

const generateResponse = await ai.models.generateContent({
  model: "gemini-2.0-flash",
  contents: createUserContent([
    prompt,
    createPartFromUri(videoFile.uri, videoFile.mimeType),
  ]),
});
console.log(generateResponse.usageMetadata);

System instructions and tools
System instructions and tools also count towards the total token count for the input.

If you use system instructions, the totalTokens count increases to reflect the addition of systemInstruction.

If you use function calling, the totalTokens count increases to reflect the addition of tools.