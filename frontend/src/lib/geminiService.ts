import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface LeetCodeSuggestion {
  title: string;
  number: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  url: string;
}

export async function getLeetCodeSuggestions(query: string): Promise<LeetCodeSuggestion[]> {
  if (!query || query.length < 2) return [];

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Find LeetCode questions matching: "${query}". Return the top 5 matches with their official title, question number, difficulty, and standard LeetCode URL.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              number: { type: Type.NUMBER },
              difficulty: { type: Type.STRING, enum: ["Easy", "Medium", "Hard"] },
              url: { type: Type.STRING }
            },
            required: ["title", "number", "difficulty", "url"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text);
  } catch (error) {
    console.error("Error fetching suggestions:", error);
    return [];
  }
}

export async function lookupLeetCodeQuestion(input: string): Promise<LeetCodeSuggestion | null> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Identify the LeetCode question for: "${input}". Return the official title, question number, difficulty, and standard LeetCode URL.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            number: { type: Type.NUMBER },
            difficulty: { type: Type.STRING, enum: ["Easy", "Medium", "Hard"] },
            url: { type: Type.STRING }
          },
          required: ["title", "number", "difficulty", "url"]
        }
      }
    });

    const text = response.text;
    if (!text) return null;
    return JSON.parse(text);
  } catch (error) {
    console.error("Error looking up question:", error);
    return null;
  }
}

export async function getProblemDescription(title: string, number: number): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a LeetCode problem scraper. Provide the full, detailed problem description, examples (Input/Output/Explanation), and constraints for LeetCode question #${number}: ${title}. 
      
      Format the output in clean Markdown. 
      Use bold for "Example 1:", "Constraints:", etc.
      Use code blocks for Input/Output.
      Ensure the description is comprehensive and matches the official LeetCode content as closely as possible.`,
    });

    return response.text || "Problem description not available.";
  } catch (error) {
    console.error("Error fetching problem description:", error);
    return "Failed to load problem description.";
  }
}

export async function getBoilerplateCode(title: string, number: number): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Provide the Python3 boilerplate code for LeetCode question #${number}: ${title}. 
      It should be in the format:
      class Solution:
          def function_name(self, params) -> type:
              # Write your code here
              pass
      
      Return ONLY the code, no markdown backticks or extra text.`,
    });

    return response.text.trim() || "class Solution:\n    def solution(self):\n        pass";
  } catch (error) {
    console.error("Error fetching boilerplate:", error);
    return "class Solution:\n    def solution(self):\n        pass";
  }
}

export async function getSocraticResponse(
  messages: { role: 'user' | 'model', parts: { text: string }[] }[],
  context: {
    mode: 'Exploratory' | 'Dig-Deeper' | 'Refinement',
    problemDescription: string,
    userCode?: string,
    testResults?: string
  }
): Promise<string> {
  const systemInstruction = `You are a Socratic Mentor. Talk less. Ask one clarifying question about logic or edge cases at a time. Never give code. After a solve, provide 3 brief bullet-point takeaways.
  
  Current Mode: ${context.mode}
  Problem: ${context.problemDescription}
  ${context.userCode ? `User's Current Code: ${context.userCode}` : ''}
  ${context.testResults ? `Test Results: ${context.testResults}` : ''}
  
  Guidelines for Modes:
  - Exploratory: Ask about the plan before the user types code.
  - Dig-Deeper: Point out fuzzy logic if the user fails a test case.
  - Refinement: Suggest optimization after a successful submission.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: messages,
      config: {
        systemInstruction,
        temperature: 0.7,
      }
    });

    return response.text || "I'm listening. What's your plan?";
  } catch (error) {
    console.error("Error getting Socratic response:", error);
    return "I'm having trouble connecting. Let's focus on the logic—what's your next step?";
  }
}
