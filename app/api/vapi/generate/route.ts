import { generateText } from "ai";
import { google } from "@ai-sdk/google";

import { db } from "@/firebase/admin";
import { getRandomInterviewCover } from "@/lib/utils";

type GenerateInterviewArgs = {
  type?: string;
  role?: string;
  level?: string;
  techstack?: string | string[];
  amount?: string | number;
  userid?: string;
  userId?: string;
};

const parseMaybeJson = (value: unknown) => {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const parseQuestions = (questions: string) => {
  const jsonArray = questions.match(/\[[\s\S]*\]/)?.[0] || questions;

  try {
    const parsed = JSON.parse(jsonArray);

    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
    ) {
      return parsed.map((question) => question.trim()).filter(Boolean);
    }
  } catch {
    // Fall back to line parsing below.
  }

  const parsedLines = questions
    .split(/\r?\n/)
    .map((question) =>
      question.replace(/^[-*\d.)\s"]+/, "").replace(/[".,\s]+$/, "").trim()
    )
    .filter(Boolean);

  if (!parsedLines.length) {
    throw new Error("Generated questions were not a string array.");
  }

  return parsedLines;
};

const toTechStack = (techstack: GenerateInterviewArgs["techstack"]) => {
  if (Array.isArray(techstack)) {
    return techstack.map((tech) => tech.trim()).filter(Boolean);
  }

  return String(techstack || "")
    .split(",")
    .map((tech) => tech.trim())
    .filter(Boolean);
};

export async function POST(request: Request) {
  const body = await request.json();

  const toolCall =
    body.message?.toolWithToolCallList?.[0]?.toolCall ||
    body.message?.toolCallList?.[0] ||
    body.toolWithToolCallList?.[0]?.toolCall ||
    body.toolCallList?.[0];

  const args = (toolCall ? parseMaybeJson(toolCall.function?.arguments) : body) as
    | GenerateInterviewArgs
    | string;
  const toolCallId = toolCall?.id || "";
  const toolName = toolCall?.function?.name || "generateInterview";

  if (typeof args === "string") {
    return Response.json(
      {
        error: "Invalid interview generation arguments.",
        ...(toolCallId
          ? {
              results: [
                {
                  name: toolName,
                  toolCallId,
                  error: "Invalid interview generation arguments.",
                },
              ],
            }
          : {}),
      },
      { status: toolCallId ? 200 : 400 }
    );
  }

  const { type, role, level, techstack, amount } = args;
  const userid = args.userid || args.userId;
  const techStackList = toTechStack(techstack);
  const questionAmount = Number(amount) || 5;

  if (!type || !role || !level || !techStackList.length || !userid) {
    const error = "Missing required interview details.";

    return Response.json(
      {
        success: false,
        error,
        ...(toolCallId
          ? {
              results: [
                {
                  name: toolName,
                  toolCallId,
                  error,
                },
              ],
            }
          : {}),
      },
      { status: toolCallId ? 200 : 400 }
    );
  }

  try {
    const { text: questions } = await generateText({
      model: google("gemini-2.0-flash-001"),
      prompt: `Prepare questions for a job interview.
        The job role is ${role}.
        The job experience level is ${level}.
        The tech stack used in the job is: ${techStackList.join(", ")}.
        The focus between behavioural and technical questions should lean towards: ${type}.
        The amount of questions required is: ${questionAmount}.
        Please return only the questions, without any additional text.
        The questions are going to be read by a voice assistant so do not use "/" or "*" or any other special characters which might break the voice assistant.
        Return the questions formatted like this:
        ["Question 1", "Question 2", "Question 3"]
        
        Thank you! <3
    `,
    });

    const interview = {
      role: role,
      type: type,
      level: level,
      techstack: techStackList,
      questions: parseQuestions(questions),
      userId: userid,
      finalized: true,
      coverImage: getRandomInterviewCover(),
      createdAt: new Date().toISOString(),
    };

    await db.collection("interviews").add(interview);

    if (toolCallId) {
      return Response.json(
        {
          results: [
            {
              name: toolName,
              toolCallId,
              result:
                "Interview created successfully. Please say goodbye to the user and politely end the call now.",
            },
          ],
        },
        { status: 200 }
      );
    }

    return Response.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to generate interview.";

    return Response.json(
      {
        success: false,
        error: message,
        ...(toolCallId
          ? {
              results: [
                {
                  name: toolName,
                  toolCallId,
                  error: message,
                },
              ],
            }
          : {}),
      },
      { status: toolCallId ? 200 : 500 }
    );
  }
}

export async function GET() {
  return Response.json({ success: true, data: "Thank you!" }, { status: 200 });
}
