Structured outputs





You can configure Gemini models to generate responses that adhere to a provided JSON Schema. This ensures predictable, type-safe results and simplifies extracting structured data from unstructured text.

Using structured outputs is ideal for:

Data extraction: Pull specific information like names and dates from text.
Structured classification: Classify text into predefined categories.
Agentic workflows: Generate structured inputs for tools or APIs.
In addition to supporting JSON Schema in the REST API, the Google GenAI SDKs make it easy to define schemas using Pydantic (Python) and Zod (JavaScript).

Recipe Extractor Content Moderation Recursive Structures

This example showcases anyOf for conditional schemas and enum for classification, allowing the output structure to vary based on the content.

Python
JavaScript
Go
REST

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const spamDetailsSchema = z.object({
  reason: z.string().describe("The reason why the content is considered spam."),
  spam_type: z.enum(["phishing", "scam", "unsolicited promotion", "other"]).describe("The type of spam."),
});

const notSpamDetailsSchema = z.object({
  summary: z.string().describe("A brief summary of the content."),
  is_safe: z.boolean().describe("Whether the content is safe for all audiences."),
});

const moderationResultSchema = z.object({
  decision: z.union([spamDetailsSchema, notSpamDetailsSchema]),
});

const ai = new GoogleGenAI({});

const prompt = `
Please moderate the following content and provide a decision.
Content: 'Congratulations! You''ve won a free cruise to the Bahamas. Click here to claim your prize: www.definitely-not-a-scam.com'
`;

const response = await ai.models.generateContent({
  model: "gemini-3-flash-preview",
  contents: prompt,
  config: {
    responseMimeType: "application/json",
    responseJsonSchema: zodToJsonSchema(moderationResultSchema),
  },
});

const result = moderationResultSchema.parse(JSON.parse(response.text));
console.log(result);
Example Response:


{
  "decision": {
    "reason": "The content is an unsolicited prize notification attempting to trick the user into clicking a suspicious link.",
    "spam_type": "scam"
  }
}
Streaming
You can stream structured outputs, which allows you to start processing the response as it's being generated, without having to wait for the entire output to be complete. This can improve the perceived performance of your application.

The streamed chunks will be valid partial JSON strings, which can be concatenated to form the final, complete JSON object.

Python
JavaScript

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const ai = new GoogleGenAI({});
const prompt = "The new UI is incredibly intuitive and visually appealing. Great job! Add a very long summary to test streaming!";

const feedbackSchema = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]),
  summary: z.string(),
});

const stream = await ai.models.generateContentStream({
  model: "gemini-3-flash-preview",
  contents: prompt,
  config: {
    responseMimeType: "application/json",
    responseJsonSchema: zodToJsonSchema(feedbackSchema),
  },
});

for await (const chunk of stream) {
  console.log(chunk.candidates[0].content.parts[0].text)
}
Structured outputs with tools
Preview: This is a feature available only for the Gemini 3 series models, gemini-3-pro-preview and gemini-3-flash-preview.
Gemini 3 lets you combine Structured Outputs with built-in tools, including Grounding with Google Search, URL Context, Code Execution, File Search, and Function Calling.

Python
JavaScript
REST

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const ai = new GoogleGenAI({});

const matchSchema = z.object({
  winner: z.string().describe("The name of the winner."),
  final_match_score: z.string().describe("The final score."),
  scorers: z.array(z.string()).describe("The name of the scorer.")
});

async function run() {
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: "Search for all details for the latest Euro.",
    config: {
      tools: [
        { googleSearch: {} },
        { urlContext: {} }
      ],
      responseMimeType: "application/json",
      responseJsonSchema: zodToJsonSchema(matchSchema),
    },
  });

  const match = matchSchema.parse(JSON.parse(response.text));
  console.log(match);
}

run();
JSON schema support
To generate a JSON object, set the response_mime_type in the generation configuration to application/json and provide a response_json_schema. The schema must be a valid JSON Schema that describes the desired output format.

The model will then generate a response that is a syntactically valid JSON string matching the provided schema. When using structured outputs, the model will produce outputs in the same order as the keys in the schema.

Gemini's structured output mode supports a subset of the JSON Schema specification.

The following values of type are supported:

string: For text.
number: For floating-point numbers.
integer: For whole numbers.
boolean: For true/false values.
object: For structured data with key-value pairs.
array: For lists of items.
null: To allow a property to be null, include "null" in the type array (e.g., {"type": ["string", "null"]}).
These descriptive properties help guide the model:

title: A short description of a property.
description: A longer and more detailed description of a property.
Type-specific properties
For object values:

properties: An object where each key is a property name and each value is a schema for that property.
required: An array of strings, listing which properties are mandatory.
additionalProperties: Controls whether properties not listed in properties are allowed. Can be a boolean or a schema.
For string values:

enum: Lists a specific set of possible strings for classification tasks.
format: Specifies a syntax for the string, such as date-time, date, time.
For number and integer values:

enum: Lists a specific set of possible numeric values.
minimum: The minimum inclusive value.
maximum: The maximum inclusive value.
For array values:

items: Defines the schema for all items in the array.
prefixItems: Defines a list of schemas for the first N items, allowing for tuple-like structures.
minItems: The minimum number of items in the array.
maxItems: The maximum number of items in the array.
Model support
The following models support structured output:

Model	Structured Outputs
Gemini 3 Pro Preview	✔️
Gemini 3 Flash Preview	✔️
Gemini 2.5 Pro	✔️
Gemini 2.5 Flash	✔️
Gemini 2.5 Flash-Lite	✔️
Gemini 2.0 Flash	✔️*
Gemini 2.0 Flash-Lite	✔️*
* Note that Gemini 2.0 requires an explicit propertyOrdering list within the JSON input to define the preferred structure. You can find an example in this cookbook.

Structured outputs vs. function calling
Both structured outputs and function calling use JSON schemas, but they serve different purposes:

Feature	Primary Use Case
Structured Outputs	Formatting the final response to the user. Use this when you want the model's answer to be in a specific format (e.g., extracting data from a document to save to a database).
Function Calling	Taking action during the conversation. Use this when the model needs to ask you to perform a task (e.g., "get current weather") before it can provide a final answer.
Best practices
Clear descriptions: Use the description field in your schema to provide clear instructions to the model about what each property represents. This is crucial for guiding the model's output.
Strong typing: Use specific types (integer, string, enum) whenever possible. If a parameter has a limited set of valid values, use an enum.
Prompt engineering: Clearly state in your prompt what you want the model to do. For example, "Extract the following information from the text..." or "Classify this feedback according to the provided schema...".
Validation: While structured output guarantees syntactically correct JSON, it does not guarantee the values are semantically correct. Always validate the final output in your application code before using it.
Error handling: Implement robust error handling in your application to gracefully manage cases where the model's output, while schema-compliant, may not meet your business logic requirements.
Limitations
Schema subset: Not all features of the JSON Schema specification are supported. The model ignores unsupported properties.
Schema complexity: The API may reject very large or deeply nested schemas. If you encounter errors, try simplifying your schema by shortening property names, reducing nesting, or limiting the number of constraints.

## function calling 
Function calling with the Gemini API





Function calling lets you connect models to external tools and APIs. Instead of generating text responses, the model determines when to call specific functions and provides the necessary parameters to execute real-world actions. This allows the model to act as a bridge between natural language and real-world actions and data. Function calling has 3 primary use cases:

Augment Knowledge: Access information from external sources like databases, APIs, and knowledge bases.
Extend Capabilities: Use external tools to perform computations and extend the limitations of the model, such as using a calculator or creating charts.
Take Actions: Interact with external systems using APIs, such as scheduling appointments, creating invoices, sending emails, or controlling smart home devices.
Get Weather Schedule Meeting Create Chart

Python
JavaScript
REST

import { GoogleGenAI, Type } from '@google/genai';

// Configure the client
const ai = new GoogleGenAI({});

// Define the function declaration for the model
const createChartFunctionDeclaration = {
  name: 'create_bar_chart',
  description: 'Creates a bar chart given a title, labels, and corresponding values.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: 'The title for the chart.',
      },
      labels: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'List of labels for the data points (e.g., ["Q1", "Q2", "Q3"]).',
      },
      values: {
        type: Type.ARRAY,
        items: { type: Type.NUMBER },
        description: 'List of numerical values corresponding to the labels (e.g., [50000, 75000, 60000]).',
      },
    },
    required: ['title', 'labels', 'values'],
  },
};

// Send request with function declarations
const response = await ai.models.generateContent({
  model: 'gemini-3-flash-preview',
  contents: "Create a bar chart titled 'Quarterly Sales' with data: Q1: 50000, Q2: 75000, Q3: 60000.",
  config: {
    tools: [{
      functionDeclarations: [createChartFunctionDeclaration]
    }],
  },
});

// Check for function calls in the response
if (response.functionCalls && response.functionCalls.length > 0) {
  const functionCall = response.functionCalls[0]; // Assuming one function call
  console.log(`Function to call: ${functionCall.name}`);
  console.log(`Arguments: ${JSON.stringify(functionCall.args)}`);
  // In a real app, you would call your actual function here:
  // const result = await createBarChart(functionCall.args);
} else {
  console.log("No function call found in the response.");
  console.log(response.text);
}
How function calling works
function calling
overview

Function calling involves a structured interaction between your application, the model, and external functions. Here's a breakdown of the process:

Define Function Declaration: Define the function declaration in your application code. Function Declarations describe the function's name, parameters, and purpose to the model.
Call LLM with function declarations: Send user prompt along with the function declaration(s) to the model. It analyzes the request and determines if a function call would be helpful. If so, it responds with a structured JSON object.
Execute Function Code (Your Responsibility): The Model does not execute the function itself. It's your application's responsibility to process the response and check for Function Call, if
Yes: Extract the name and args of the function and execute the corresponding function in your application.
No: The model has provided a direct text response to the prompt (this flow is less emphasized in the example but is a possible outcome).
Create User friendly response: If a function was executed, capture the result and send it back to the model in a subsequent turn of the conversation. It will use the result to generate a final, user-friendly response that incorporates the information from the function call.
This process can be repeated over multiple turns, allowing for complex interactions and workflows. The model also supports calling multiple functions in a single turn (parallel function calling) and in sequence (compositional function calling).

Step 1: Define a function declaration
Define a function and its declaration within your application code that allows users to set light values and make an API request. This function could call external services or APIs.

Python
JavaScript

import { Type } from '@google/genai';

// Define a function that the model can call to control smart lights
const setLightValuesFunctionDeclaration = {
  name: 'set_light_values',
  description: 'Sets the brightness and color temperature of a light.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      brightness: {
        type: Type.NUMBER,
        description: 'Light level from 0 to 100. Zero is off and 100 is full brightness',
      },
      color_temp: {
        type: Type.STRING,
        enum: ['daylight', 'cool', 'warm'],
        description: 'Color temperature of the light fixture, which can be `daylight`, `cool` or `warm`.',
      },
    },
    required: ['brightness', 'color_temp'],
  },
};

/**

*   Set the brightness and color temperature of a room light. (mock API)
*   @param {number} brightness - Light level from 0 to 100. Zero is off and 100 is full brightness
*   @param {string} color_temp - Color temperature of the light fixture, which can be `daylight`, `cool` or `warm`.
*   @return {Object} A dictionary containing the set brightness and color temperature.
*/
function setLightValues(brightness, color_temp) {
  return {
    brightness: brightness,
    colorTemperature: color_temp
  };
}
Step 2: Call the model with function declarations
Once you have defined your function declarations, you can prompt the model to use them. It analyzes the prompt and function declarations and decides whether to respond directly or to call a function. If a function is called, the response object will contain a function call suggestion.

Python
JavaScript

import { GoogleGenAI } from '@google/genai';

// Generation config with function declaration
const config = {
  tools: [{
    functionDeclarations: [setLightValuesFunctionDeclaration]
  }]
};

// Configure the client
const ai = new GoogleGenAI({});

// Define user prompt
const contents = [
  {
    role: 'user',
    parts: [{ text: 'Turn the lights down to a romantic level' }]
  }
];

// Send request with function declarations
const response = await ai.models.generateContent({
  model: 'gemini-3-flash-preview',
  contents: contents,
  config: config
});

console.log(response.functionCalls[0]);
The model then returns a functionCall object in an OpenAPI compatible schema specifying how to call one or more of the declared functions in order to respond to the user's question.

Python
JavaScript

{
  name: 'set_light_values',
  args: { brightness: 25, color_temp: 'warm' }
}
Step 3: Execute set_light_values function code
Extract the function call details from the model's response, parse the arguments , and execute the set_light_values function.

Python
JavaScript

// Extract tool call details
const tool_call = response.functionCalls[0]

let result;
if (tool_call.name === 'set_light_values') {
  result = setLightValues(tool_call.args.brightness, tool_call.args.color_temp);
  console.log(`Function execution result: ${JSON.stringify(result)}`);
}
Step 4: Create user friendly response with function result and call the model again
Finally, send the result of the function execution back to the model so it can incorporate this information into its final response to the user.

Python
JavaScript

// Create a function response part
const function_response_part = {
  name: tool_call.name,
  response: { result }
}

// Append function call and result of the function execution to contents
contents.push(response.candidates[0].content);
contents.push({ role: 'user', parts: [{ functionResponse: function_response_part }] });

// Get the final response from the model
const final_response = await ai.models.generateContent({
  model: 'gemini-3-flash-preview',
  contents: contents,
  config: config
});

console.log(final_response.text);
This completes the function calling flow. The model successfully used the set_light_values function to perform the request action of the user.

Function declarations
When you implement function calling in a prompt, you create a tools object, which contains one or more function declarations. You define functions using JSON, specifically with a select subset of the OpenAPI schema format. A single function declaration can include the following parameters:

name (string): A unique name for the function (get_weather_forecast, send_email). Use descriptive names without spaces or special characters (use underscores or camelCase).
description (string): A clear and detailed explanation of the function's purpose and capabilities. This is crucial for the model to understand when to use the function. Be specific and provide examples if helpful ("Finds theaters based on location and optionally movie title which is currently playing in theaters.").
parameters (object): Defines the input parameters the function expects.
type (string): Specifies the overall data type, such as object.
properties (object): Lists individual parameters, each with:
type (string): The data type of the parameter, such as string, integer, boolean, array.
description (string): A description of the parameter's purpose and format. Provide examples and constraints ("The city and state, e.g., 'San Francisco, CA' or a zip code e.g., '95616'.").
enum (array, optional): If the parameter values are from a fixed set, use "enum" to list the allowed values instead of just describing them in the description. This improves accuracy ("enum": ["daylight", "cool", "warm"]).
required (array): An array of strings listing the parameter names that are mandatory for the function to operate.
You can also construct FunctionDeclarations from Python functions directly using types.FunctionDeclaration.from_callable(client=client, callable=your_function).

Function calling with thinking models
Gemini 3 and 2.5 series models use an internal "thinking" process to reason through requests. This significantly improves function calling performance, allowing the model to better determine when to call a function and which parameters to use. Because the Gemini API is stateless, models use thought signatures to maintain context across multi-turn conversations.

This section covers advanced management of thought signatures and is only necessary if you're manually constructing API requests (e.g., via REST) or manipulating conversation history.

If you're using the Google GenAI SDKs (our official libraries), you don't need to manage this process. The SDKs automatically handle the necessary steps, as shown in the earlier example.

Managing conversation history manually
If you modify the conversation history manually, instead of sending the complete previous response you must correctly handle the thought_signature included in the model's turn.

Follow these rules to ensure the model's context is preserved:

Always send the thought_signature back to the model inside its original Part.
Don't merge a Part containing a signature with one that does not. This breaks the positional context of the thought.
Don't combine two Parts that both contain signatures, as the signature strings cannot be merged.
Gemini 3 thought signatures
In Gemini 3, any Part of a model response may contain a thought signature. While we generally recommend returning signatures from all Part types, passing back thought signatures is mandatory for function calling. Unless you are manipulating conversation history manually, the Google GenAI SDK will handle thought signatures automatically.

If you are manipulating conversation history manually, refer to the Thoughts Signatures page for complete guidance and details on handling thought signatures for Gemini 3.

Inspecting thought signatures
While not necessary for implementation, you can inspect the response to see the thought_signature for debugging or educational purposes.

Python
JavaScript

// After receiving a response from a model with thinking enabled
// const response = await ai.models.generateContent(...)

// The signature is attached to the response part containing the function call
const part = response.candidates[0].content.parts[0];
if (part.thoughtSignature) {
  console.log(part.thoughtSignature);
}
Learn more about limitations and usage of thought signatures, and about thinking models in general, on the Thinking page.

Parallel function calling
In addition to single turn function calling, you can also call multiple functions at once. Parallel function calling lets you execute multiple functions at once and is used when the functions are not dependent on each other. This is useful in scenarios like gathering data from multiple independent sources, such as retrieving customer details from different databases or checking inventory levels across various warehouses or performing multiple actions such as converting your apartment into a disco.

Python
JavaScript

import { Type } from '@google/genai';

const powerDiscoBall = {
  name: 'power_disco_ball',
  description: 'Powers the spinning disco ball.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      power: {
        type: Type.BOOLEAN,
        description: 'Whether to turn the disco ball on or off.'
      }
    },
    required: ['power']
  }
};

const startMusic = {
  name: 'start_music',
  description: 'Play some music matching the specified parameters.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      energetic: {
        type: Type.BOOLEAN,
        description: 'Whether the music is energetic or not.'
      },
      loud: {
        type: Type.BOOLEAN,
        description: 'Whether the music is loud or not.'
      }
    },
    required: ['energetic', 'loud']
  }
};

const dimLights = {
  name: 'dim_lights',
  description: 'Dim the lights.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      brightness: {
        type: Type.NUMBER,
        description: 'The brightness of the lights, 0.0 is off, 1.0 is full.'
      }
    },
    required: ['brightness']
  }
};
Configure the function calling mode to allow using all of the specified tools. To learn more, you can read about configuring function calling.

Python
JavaScript

import { GoogleGenAI } from '@google/genai';

// Set up function declarations
const houseFns = [powerDiscoBall, startMusic, dimLights];

const config = {
    tools: [{
        functionDeclarations: houseFns
    }],
    // Force the model to call 'any' function, instead of chatting.
    toolConfig: {
        functionCallingConfig: {
            mode: 'any'
        }
    }
};

// Configure the client
const ai = new GoogleGenAI({});

// Create a chat session
const chat = ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: config
});
const response = await chat.sendMessage({message: 'Turn this place into a party!'});

// Print out each of the function calls requested from this single call
console.log("Example 1: Forced function calling");
for (const fn of response.functionCalls) {
    const args = Object.entries(fn.args)
        .map(([key, val]) => `${key}=${val}`)
        .join(', ');
    console.log(`${fn.name}(${args})`);
}
Each of the printed results reflects a single function call that the model has requested. To send the results back, include the responses in the same order as they were requested.

The Python SDK supports automatic function calling, which automatically converts Python functions to declarations, handles the function call execution and response cycle for you. Following is an example for the disco use case.

Note: Automatic Function Calling is a Python SDK only feature at the moment.
Python

from google import genai
from google.genai import types

# Actual function implementations
def power_disco_ball_impl(power: bool) -> dict:
    """Powers the spinning disco ball.

    Args:
        power: Whether to turn the disco ball on or off.

    Returns:
        A status dictionary indicating the current state.
    """
    return {"status": f"Disco ball powered {'on' if power else 'off'}"}

def start_music_impl(energetic: bool, loud: bool) -> dict:
    """Play some music matching the specified parameters.

    Args:
        energetic: Whether the music is energetic or not.
        loud: Whether the music is loud or not.

    Returns:
        A dictionary containing the music settings.
    """
    music_type = "energetic" if energetic else "chill"
    volume = "loud" if loud else "quiet"
    return {"music_type": music_type, "volume": volume}

def dim_lights_impl(brightness: float) -> dict:
    """Dim the lights.

    Args:
        brightness: The brightness of the lights, 0.0 is off, 1.0 is full.

    Returns:
        A dictionary containing the new brightness setting.
    """
    return {"brightness": brightness}

# Configure the client
client = genai.Client()
config = types.GenerateContentConfig(
    tools=[power_disco_ball_impl, start_music_impl, dim_lights_impl]
)

# Make the request
response = client.models.generate_content(
    model="gemini-3-flash-preview",
    contents="Do everything you need to this place into party!",
    config=config,
)

print("\nExample 2: Automatic function calling")
print(response.text)
# I've turned on the disco ball, started playing loud and energetic music, and dimmed the lights to 50% brightness. Let's get this party started!
Compositional function calling
Compositional or sequential function calling allows Gemini to chain multiple function calls together to fulfill a complex request. For example, to answer "Get the temperature in my current location", the Gemini API might first invoke a get_current_location() function followed by a get_weather() function that takes the location as a parameter.

The following example demonstrates how to implement compositional function calling using the Python SDK and automatic function calling.

Python
JavaScript
This example shows how to use JavaScript/TypeScript SDK to do comopositional function calling using a manual execution loop.


import { GoogleGenAI, Type } from "@google/genai";

// Configure the client
const ai = new GoogleGenAI({});

// Example Functions
function get_weather_forecast({ location }) {
  console.log(`Tool Call: get_weather_forecast(location=${location})`);
  // TODO: Make API call
  console.log("Tool Response: {'temperature': 25, 'unit': 'celsius'}");
  return { temperature: 25, unit: "celsius" };
}

function set_thermostat_temperature({ temperature }) {
  console.log(
    `Tool Call: set_thermostat_temperature(temperature=${temperature})`,
  );
  // TODO: Make API call
  console.log("Tool Response: {'status': 'success'}");
  return { status: "success" };
}

const toolFunctions = {
  get_weather_forecast,
  set_thermostat_temperature,
};

const tools = [
  {
    functionDeclarations: [
      {
        name: "get_weather_forecast",
        description:
          "Gets the current weather temperature for a given location.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            location: {
              type: Type.STRING,
            },
          },
          required: ["location"],
        },
      },
      {
        name: "set_thermostat_temperature",
        description: "Sets the thermostat to a desired temperature.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            temperature: {
              type: Type.NUMBER,
            },
          },
          required: ["temperature"],
        },
      },
    ],
  },
];

// Prompt for the model
let contents = [
  {
    role: "user",
    parts: [
      {
        text: "If it's warmer than 20°C in London, set the thermostat to 20°C, otherwise set it to 18°C.",
      },
    ],
  },
];

// Loop until the model has no more function calls to make
while (true) {
  const result = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents,
    config: { tools },
  });

  if (result.functionCalls && result.functionCalls.length > 0) {
    const functionCall = result.functionCalls[0];

    const { name, args } = functionCall;

    if (!toolFunctions[name]) {
      throw new Error(`Unknown function call: ${name}`);
    }

    // Call the function and get the response.
    const toolResponse = toolFunctions[name](args);

    const functionResponsePart = {
      name: functionCall.name,
      response: {
        result: toolResponse,
      },
    };

    // Send the function response back to the model.
    contents.push({
      role: "model",
      parts: [
        {
          functionCall: functionCall,
        },
      ],
    });
    contents.push({
      role: "user",
      parts: [
        {
          functionResponse: functionResponsePart,
        },
      ],
    });
  } else {
    // No more function calls, break the loop.
    console.log(result.text);
    break;
  }
}
Expected Output

When you run the code, you will see the SDK orchestrating the function calls. The model first calls get_weather_forecast, receives the temperature, and then calls set_thermostat_temperature with the correct value based on the logic in the prompt.


Tool Call: get_weather_forecast(location=London)
Tool Response: {'temperature': 25, 'unit': 'celsius'}
Tool Call: set_thermostat_temperature(temperature=20)
Tool Response: {'status': 'success'}
OK. It's 25°C in London, so I've set the thermostat to 20°C.
Compositional function calling is a native Live API feature. This means Live API can handle the function calling similar to the Python SDK.

Python
JavaScript

// Light control schemas
const turnOnTheLightsSchema = { name: 'turn_on_the_lights' };
const turnOffTheLightsSchema = { name: 'turn_off_the_lights' };

const prompt = `
  Hey, can you write run some python code to turn on the lights, wait 10s and then turn off the lights?
`;

const tools = [
  { codeExecution: {} },
  { functionDeclarations: [turnOnTheLightsSchema, turnOffTheLightsSchema] }
];

await run(prompt, tools=tools, modality="AUDIO")
Function calling modes
The Gemini API lets you control how the model uses the provided tools (function declarations). Specifically, you can set the mode within the.function_calling_config.

AUTO (Default): The model decides whether to generate a natural language response or suggest a function call based on the prompt and context. This is the most flexible mode and recommended for most scenarios.
ANY: The model is constrained to always predict a function call and guarantees function schema adherence. If allowed_function_names is not specified, the model can choose from any of the provided function declarations. If allowed_function_names is provided as a list, the model can only choose from the functions in that list. Use this mode when you require a function call response to every prompt (if applicable).
NONE: The model is prohibited from making function calls. This is equivalent to sending a request without any function declarations. Use this to temporarily disable function calling without removing your tool definitions.
VALIDATED (Preview): The model is constrained to predict either function calls or natural language, and ensures function schema adherence. If allowed_function_names is not provided, the model picks from all of the available function declarations. If allowed_function_names is provided, the model picks from the set of allowed functions.

Python
JavaScript

import { FunctionCallingConfigMode } from '@google/genai';

// Configure function calling mode
const toolConfig = {
  functionCallingConfig: {
    mode: FunctionCallingConfigMode.ANY,
    allowedFunctionNames: ['get_current_temperature']
  }
};

// Create the generation config
const config = {
  tools: tools, // not defined here.
  toolConfig: toolConfig,
};
Automatic function calling (Python only)
When using the Python SDK, you can provide Python functions directly as tools. The SDK converts these functions into declarations, manages the function call execution, and handles the response cycle for you. Define your function with type hints and a docstring. For optimal results, it is recommended to use Google-style docstrings. The SDK will then automatically:

Detect function call responses from the model.
Call the corresponding Python function in your code.
Send the function's response back to the model.
Return the model's final text response.
The SDK currently does not parse argument descriptions into the property description slots of the generated function declaration. Instead, it sends the entire docstring as the top-level function description.

Python

from google import genai
from google.genai import types

# Define the function with type hints and docstring
def get_current_temperature(location: str) -> dict:
    """Gets the current temperature for a given location.

    Args:
        location: The city and state, e.g. San Francisco, CA

    Returns:
        A dictionary containing the temperature and unit.
    """
    # ... (implementation) ...
    return {"temperature": 25, "unit": "Celsius"}

# Configure the client
client = genai.Client()
config = types.GenerateContentConfig(
    tools=[get_current_temperature]
)  # Pass the function itself

# Make the request
response = client.models.generate_content(
    model="gemini-3-flash-preview",
    contents="What's the temperature in Boston?",
    config=config,
)

print(response.text)  # The SDK handles the function call and returns the final text
You can disable automatic function calling with:

Python

config = types.GenerateContentConfig(
    tools=[get_current_temperature],
    automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True)
)
Automatic function schema declaration
The API is able to describe any of the following types. Pydantic types are allowed, as long as the fields defined on them are also composed of allowed types. Dict types (like dict[str: int]) are not well supported here, don't use them.

Python

AllowedType = (
  int | float | bool | str | list['AllowedType'] | pydantic.BaseModel)
To see what the inferred schema looks like, you can convert it using from_callable:

Python

from google import genai
from google.genai import types

def multiply(a: float, b: float):
    """Returns a * b."""
    return a * b

client = genai.Client()
fn_decl = types.FunctionDeclaration.from_callable(callable=multiply, client=client)

# to_json_dict() provides a clean JSON representation.
print(fn_decl.to_json_dict())
Multi-tool use: Combine native tools with function calling
You can enable multiple tools combining native tools with function calling at the same time. Here's an example that enables two tools, Grounding with Google Search and code execution, in a request using the Live API.

Note: Multi-tool use is a-Live API only feature at the moment. The run() function declaration, which handles the asynchronous websocket setup, is omitted for brevity.
Python
JavaScript

// Multiple tasks example - combining lights, code execution, and search
const prompt = `
  Hey, I need you to do three things for me.

    1.  Turn on the lights.
    2.  Then compute the largest prime palindrome under 100000.
    3.  Then use Google Search to look up information about the largest earthquake in California the week of Dec 5 2024.

  Thanks!
`;

const tools = [
  { googleSearch: {} },
  { codeExecution: {} },
  { functionDeclarations: [turnOnTheLightsSchema, turnOffTheLightsSchema] } // not defined here.
];

// Execute the prompt with specified tools in audio modality
await run(prompt, {tools: tools, modality: "AUDIO"});
Python developers can try this out in the Live API Tool Use notebook.

Multimodal function responses
Note: This feature is available for Gemini 3 series models.
For Gemini 3 series models, you can include multimodal content in the function response parts that you send to the model. The model can process this multimodal content in its next turn to produce a more informed response. The following MIME types are supported for multimodal content in function responses:

Images: image/png, image/jpeg, image/webp
Documents: application/pdf, text/plain
To include multimodal data in a function response, include it as one or more parts nested within the functionResponse part. Each multimodal part must contain inlineData. If you reference a multimodal part from within the structured response field, it must contain a unique displayName.

You can also reference a multimodal part from within the structured response field of the functionResponse part by using the JSON reference format {"$ref": "<displayName>"}. The model substitutes the reference with the multimodal content when processing the response. Each displayName can only be referenced once in the structured response field.

The following example shows a message containing a functionResponse for a function named get_image and a nested part containing image data with displayName: "instrument.jpg". The functionResponse's response field references this image part:

Python
JavaScript
REST

import { GoogleGenAI, Type } from '@google/genai';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// This is a manual, two turn multimodal function calling workflow:
// 1. Define the function tool
const getImageDeclaration = {
  name: 'get_image',
  description: 'Retrieves the image file reference for a specific order item.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      item_name: {
        type: Type.STRING,
        description: "The name or description of the item ordered (e.g., 'instrument').",
      },
    },
    required: ['item_name'],
  },
};

const toolConfig = {
  functionDeclarations: [getImageDeclaration],
};

// 2. Send a message that triggers the tool
const prompt = 'Show me the instrument I ordered last month.';
const response1 = await client.models.generateContent({
  model: 'gemini-3-flash-preview',
  contents: prompt,
  config: {
    tools: [toolConfig],
  },
});

// 3. Handle the function call
const functionCall = response1.functionCalls[0];
const requestedItem = functionCall.args.item_name;
console.log(`Model wants to call: ${functionCall.name}`);

// Execute your tool (e.g., call an API)
// (This is a mock response for the example)
console.log(`Calling external tool for: ${requestedItem}`);

const functionResponseData = {
  image_ref: { $ref: 'instrument.jpg' },
};

const imageUrl = "https://goo.gle/instrument-img";
const response = await fetch(imageUrl);
const imageArrayBuffer = await response.arrayBuffer();
const base64ImageData = Buffer.from(imageArrayBuffer).toString('base64');

const functionResponseMultimodalData = {
  inlineData: {
    mimeType: 'image/jpeg',
    displayName: 'instrument.jpg',
    data: base64ImageData,
  },
};

// 4. Send the tool's result back
// Append this turn's messages to history for a final response.
const history = [
  { role: 'user', parts: [{ text: prompt }] },
  response1.candidates[0].content,
  {
    role: 'tool',
    parts: [
      {
        functionResponse: {
          name: functionCall.name,
          response: functionResponseData,
          parts: [functionResponseMultimodalData],
        },
      },
    ],
  },
];

const response2 = await client.models.generateContent({
  model: 'gemini-3-flash-preview',
  contents: history,
  config: {
    tools: [toolConfig],
    thinkingConfig: { includeThoughts: true },
  },
});

console.log(`\nFinal model response: ${response2.text}`);
Function calling with Structured output
Note: This feature is available for Gemini 3 series models.
For Gemini 3 series models, you can use function calling with structured output. This lets the model predict function calls or outputs that adhere to a specific schema. As a result, you receive consistently formatted responses when the model doesn't generate function calls.

Model context protocol (MCP)
Model Context Protocol (MCP) is an open standard for connecting AI applications with external tools and data. MCP provides a common protocol for models to access context, such as functions (tools), data sources (resources), or predefined prompts.

The Gemini SDKs have built-in support for the MCP, reducing boilerplate code and offering automatic tool calling for MCP tools. When the model generates an MCP tool call, the Python and JavaScript client SDK can automatically execute the MCP tool and send the response back to the model in a subsequent request, continuing this loop until no more tool calls are made by the model.

Here, you can find an example of how to use a local MCP server with Gemini and mcp SDK.

Python
JavaScript
Make sure the latest version of the mcp SDK is installed on your platform of choice.


npm install @modelcontextprotocol/sdk
Note: JavaScript supports automatic tool calling by wrapping the client with mcpToTool. If you want to disable it, you can provide automaticFunctionCalling with disabled true.

import { GoogleGenAI, FunctionCallingConfigMode , mcpToTool} from '@google/genai';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Create server parameters for stdio connection
const serverParams = new StdioClientTransport({
  command: "npx", // Executable
  args: ["-y", "@philschmid/weather-mcp"] // MCP Server
});

const client = new Client(
  {
    name: "example-client",
    version: "1.0.0"
  }
);

// Configure the client
const ai = new GoogleGenAI({});

// Initialize the connection between client and server
await client.connect(serverParams);

// Send request to the model with MCP tools
const response = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: `What is the weather in London in ${new Date().toLocaleDateString()}?`,
  config: {
    tools: [mcpToTool(client)],  // uses the session, will automatically call the tool
    // Uncomment if you **don't** want the sdk to automatically call the tool
    // automaticFunctionCalling: {
    //   disable: true,
    // },
  },
});
console.log(response.text)

// Close the connection
await client.close();
Limitations with built-in MCP support
Built-in MCP support is a experimental feature in our SDKs and has the following limitations:

Only tools are supported, not resources nor prompts
It is available for the Python and JavaScript/TypeScript SDK.
Breaking changes might occur in future releases.
Manual integration of MCP servers is always an option if these limit what you're building.

Supported models
This section lists models and their function calling capabilities. Experimental models are not included. You can find a comprehensive capabilities overview on the model overview page.

Model	Function Calling	Parallel Function Calling	Compositional Function Calling
Gemini 3 Pro	✔️	✔️	✔️
Gemini 3 Flash	✔️	✔️	✔️
Gemini 2.5 Pro	✔️	✔️	✔️
Gemini 2.5 Flash	✔️	✔️	✔️
Gemini 2.5 Flash-Lite	✔️	✔️	✔️
Gemini 2.0 Flash	✔️	✔️	✔️
Gemini 2.0 Flash-Lite	X	X	X
Best practices
Function and Parameter Descriptions: Be extremely clear and specific in your descriptions. The model relies on these to choose the correct function and provide appropriate arguments.
Naming: Use descriptive function names (without spaces, periods, or dashes).
Strong Typing: Use specific types (integer, string, enum) for parameters to reduce errors. If a parameter has a limited set of valid values, use an enum.
Tool Selection: While the model can use an arbitrary number of tools, providing too many can increase the risk of selecting an incorrect or suboptimal tool. For best results, aim to provide only the relevant tools for the context or task, ideally keeping the active set to a maximum of 10-20. Consider dynamic tool selection based on conversation context if you have a large total number of tools.
Prompt Engineering:
Provide context: Tell the model its role (e.g., "You are a helpful weather assistant.").
Give instructions: Specify how and when to use functions (e.g., "Don't guess dates; always use a future date for forecasts.").
Encourage clarification: Instruct the model to ask clarifying questions if needed.
See Agentic workflows for further strategies on designing these prompts. Here is an example of a tested system instruction.
Temperature: Use a low temperature (e.g., 0) for more deterministic and reliable function calls.

When using Gemini 3 models, we strongly recommend keeping the temperature at its default value of 1.0. Changing the temperature (setting it below 1.0) may lead to unexpected behavior, such as looping or degraded performance, particularly in complex mathematical or reasoning tasks.
Validation: If a function call has significant consequences (e.g., placing an order), validate the call with the user before executing it.

Check Finish Reason: Always check the finishReason in the model's response to handle cases where the model failed to generate a valid function call.

Error Handling: Implement robust error handling in your functions to gracefully handle unexpected inputs or API failures. Return informative error messages that the model can use to generate helpful responses to the user.

Security: Be mindful of security when calling external APIs. Use appropriate authentication and authorization mechanisms. Avoid exposing sensitive data in function calls.

Token Limits: Function descriptions and parameters count towards your input token limit. If you're hitting token limits, consider limiting the number of functions or the length of the descriptions, break down complex tasks into smaller, more focused function sets.

Notes and limitations
Only a subset of the OpenAPI schema is supported.
For ANY mode, the API may reject very large or deeply nested schemas. If you encounter errors, try simplifying your function parameter and response schemas by shortening property names, reducing nesting, or limiting the number of function declarations.
Supported parameter types in Python are limited.
Automatic function calling is a Python SDK feature only.

# long context
Many Gemini models come with large context windows of 1 million or more tokens.
Historically, large language models (LLMs) were significantly limited by
the amount of text (or tokens) that could be passed to the model at one time.
The Gemini long context window unlocks many new use cases and developer
paradigms.

The code you already use for cases like [text
generation](https://ai.google.dev/gemini-api/docs/text-generation) or [multimodal
inputs](https://ai.google.dev/gemini-api/docs/vision) will work without any changes with long context.

This document gives you an overview of what you can achieve using models with
context windows of 1M and more tokens. The page gives a brief overview of
a context window, and explores how developers should think about long context,
various real world use cases for long context, and ways to optimize the usage
of long context.

For the context window sizes of specific models, see the
[Models](https://ai.google.dev/gemini-api/docs/models) page.

## What is a context window?

The basic way you use the Gemini models is by passing information (context)
to the model, which will subsequently generate a response. An analogy for the
context window is short term memory. There is a limited amount of information
that can be stored in someone's short term memory, and the same is true for
generative models.

You can read more about how models work under the hood in our [generative models
guide](https://ai.google.dev/gemini-api/docs/prompting-strategies#under-the-hood).

## Getting started with long context

Earlier versions of generative models were only able to process 8,000
tokens at a time. Newer models pushed this further by accepting 32,000 or even
128,000 tokens. Gemini is the first model capable of accepting 1 million tokens.

In practice, 1 million tokens would look like:

- 50,000 lines of code (with the standard 80 characters per line)
- All the text messages you have sent in the last 5 years
- 8 average length English novels
- Transcripts of over 200 average length podcast episodes

The more limited context windows common in many other models often require
strategies like arbitrarily dropping old messages, summarizing content, using
RAG with vector databases, or filtering prompts to save tokens.

While these techniques remain valuable in specific scenarios, Gemini's extensive
context window invites a more direct approach: providing all relevant
information upfront. Because Gemini models were purpose-built with massive
context capabilities, they demonstrate powerful in-context learning. For
example, using only in-context instructional materials (a 500-page reference
grammar, a dictionary, and ≈400 parallel sentences), Gemini
[learned to translate](https://storage.googleapis.com/deepmind-media/gemini/gemini_v1_5_report.pdf)
from English to Kalamang---a Papuan language with
fewer than 200 speakers---with quality similar to a human learner using the same
materials. This illustrates the paradigm shift enabled by Gemini's long context,
empowering new possibilities through robust in-context learning.

## Long context use cases

While the standard use case for most generative models is still text input, the
Gemini model family enables a new paradigm of multimodal use cases. These
models can natively understand text, video, audio, and images. They are
accompanied by the [Gemini API that takes in multimodal file
types](https://ai.google.dev/gemini-api/docs/prompting_with_media) for
convenience.

### Long form text

Text has proved to be the layer of intelligence underpinning much of the
momentum around LLMs. As mentioned earlier, much of the practical limitation of
LLMs was because of not having a large enough context window to do certain
tasks. This led to the rapid adoption of retrieval augmented generation (RAG)
and other techniques which dynamically provide the model with relevant
contextual information. Now, with larger and larger context windows, there are
new techniques becoming available which unlock new use cases.

Some emerging and standard use cases for text based long context include:

- Summarizing large corpuses of text
  - Previous summarization options with smaller context models would require a sliding window or another technique to keep state of previous sections as new tokens are passed to the model
- Question and answering
  - Historically this was only possible with RAG given the limited amount of context and models' factual recall being low
- Agentic workflows
  - Text is the underpinning of how agents keep state of what they have done and what they need to do; not having enough information about the world and the agent's goal is a limitation on the reliability of agents

[Many-shot in-context learning](https://arxiv.org/pdf/2404.11018) is one of the
most unique capabilities unlocked by long context models. Research has shown
that taking the common "single shot" or "multi-shot" example paradigm, where the
model is presented with one or a few examples of a task, and scaling that up to
hundreds, thousands, or even hundreds of thousands of examples, can lead to
novel model capabilities. This many-shot approach has also been shown to perform
similarly to models which were fine-tuned for a specific task. For use cases
where a Gemini model's performance is not yet sufficient for a production
rollout, you can try the many-shot approach. As you might explore later in the
long context optimization section, context caching makes this type of high input
token workload much more economically feasible and even lower latency in some
cases.

### Long form video

Video content's utility has long been constrained by the lack of accessibility
of the medium itself. It was hard to skim the content, transcripts often failed
to capture the nuance of a video, and most tools don't process image, text, and
audio together. With Gemini, the long-context text capabilities translate to
the ability to reason and answer questions about multimodal inputs with
sustained performance.

Some emerging and standard use cases for video long context include:

- Video question and answering
- Video memory, as shown with [Google's Project Astra](https://deepmind.google/technologies/gemini/project-astra/)
- Video captioning
- Video recommendation systems, by enriching existing metadata with new multimodal understanding
- Video customization, by looking at a corpus of data and associated video metadata and then removing parts of videos that are not relevant to the viewer
- Video content moderation
- Real-time video processing

When working with videos, it is important to consider how the [videos are
processed into tokens](https://ai.google.dev/gemini-api/docs/tokens#media-token), which affects
billing and usage limits. You can learn more about prompting with video files in
the [Prompting
guide](https://ai.google.dev/gemini-api/docs/prompting_with_media?lang=python#prompting-with-videos).

### Long form audio

The Gemini models were the first natively multimodal large language models
that could understand audio. Historically, the typical developer workflow would
involve stringing together multiple domain specific models, like a
speech-to-text model and a text-to-text model, in order to process audio. This
led to additional latency required by performing multiple round-trip requests
and decreased performance usually attributed to disconnected architectures of
the multiple model setup.

Some emerging and standard use cases for audio context include:

- Real-time transcription and translation
- Podcast / video question and answering
- Meeting transcription and summarization
- Voice assistants

You can learn more about prompting with audio files in the [Prompting
guide](https://ai.google.dev/gemini-api/docs/prompting_with_media?lang=python#prompting-with-videos).

## Long context optimizations

The primary optimization when working with long context and the Gemini
models is to use [context
caching](https://ai.google.dev/gemini-api/docs/caching). Beyond the previous
impossibility of processing lots of tokens in a single request, the other main
constraint was the cost. If you have a "chat with your data" app where a user
uploads 10 PDFs, a video, and some work documents, you would historically have
to work with a more complex retrieval augmented generation (RAG) tool /
framework in order to process these requests and pay a significant amount for
tokens moved into the context window. Now, you can cache the files the user
uploads and pay to store them on a per hour basis. The input / output cost per
request with Gemini Flash for example is \~4x less than the standard
input / output cost, so if
the user chats with their data enough, it becomes a huge cost saving for you as
the developer.

## Long context limitations

In various sections of this guide, we talked about how Gemini models achieve
high performance across various needle-in-a-haystack retrieval evals. These
tests consider the most basic setup, where you have a single needle you are
looking for. In cases where you might have multiple "needles" or specific pieces
of information you are looking for, the model does not perform with the same
accuracy. Performance can vary to a wide degree depending on the context. This
is important to consider as there is an inherent tradeoff between getting the
right information retrieved and cost. You can get \~99% on a single query, but
you have to pay the input token cost every time you send that query. So for 100
pieces of information to be retrieved, if you needed 99% performance, you would
likely need to send 100 requests. This is a good example of where context
caching can significantly reduce the cost associated with using Gemini models
while keeping the performance high.

## FAQs

### Where is the best place to put my query in the context window?

In most cases, especially if the total context is long, the model's
performance will be better if you put your query / question at the end of the
prompt (after all the other context).

### Do I lose model performance when I add more tokens to a query?

Generally, if you don't need tokens to be passed to the model, it is best to
avoid passing them. However, if you have a large chunk of tokens with some
information and want to ask questions about that information, the model is
highly capable of extracting that information (up to 99% accuracy in many
cases).

### How can I lower my cost with long-context queries?

If you have a similar set of tokens / context that you want to re-use many
times, [context caching](https://ai.google.dev/gemini-api/docs/caching) can help reduce the costs
associated with asking questions about that information.

### Does the context length affect the model latency?

There is some fixed amount of latency in any given request, regardless of the
size, but generally longer queries will have higher latency (time to first
token).