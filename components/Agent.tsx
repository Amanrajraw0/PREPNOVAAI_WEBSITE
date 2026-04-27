"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { vapi } from "@/lib/vapi.sdk";
import { interviewer, interviewTranscriber } from "@/constants";
import { createFeedback } from "@/lib/actions/general.action";

enum CallStatus {
  INACTIVE = "INACTIVE",
  CONNECTING = "CONNECTING",
  ACTIVE = "ACTIVE",
  FINISHED = "FINISHED",
}

interface SavedMessage {
  role: "user" | "system" | "assistant";
  content: string;
}

type VapiErrorEvent = {
  type?: string;
  stage?: string;
  error?: {
    message?: string;
    code?: string;
    status?: number;
  };
  message?: string;
  context?: Record<string, unknown>;
};

const getVapiErrorMessage = (error: unknown) => {
  const errorEvent = error as VapiErrorEvent;
  
  let message = "";
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof errorEvent?.error?.message === "string") {
    message = errorEvent.error.message;
  } else if (typeof errorEvent?.message === "string") {
    message = errorEvent.message;
  } else if (typeof error === "string") {
    message = error;
  } else {
    try {
      message = JSON.stringify(error);
    } catch {
      message = "Unknown error";
    }
  }

  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("permission") ||
    lowerMessage.includes("notallowed") ||
    lowerMessage.includes("not allowed")
  ) {
    return "Microphone permission is blocked. Allow microphone access in your browser and try again.";
  }

  if (
    lowerMessage.includes("notfound") ||
    lowerMessage.includes("not found") ||
    lowerMessage.includes("device")
  ) {
    return "No working microphone was found. Check your input device and try again.";
  }

  if (
    lowerMessage.includes("assistant") ||
    lowerMessage.includes("workflow") ||
    lowerMessage.includes("unauthorized") ||
    lowerMessage.includes("401") ||
    lowerMessage.includes("403") ||
    lowerMessage.includes("404")
  ) {
    return "Vapi could not start the call. Check the Vapi public key and assistant/workflow ID in your deployment environment.";
  }

  return "The call failed. Please check your microphone and try again.";
};

const isProbablyWorkflowId = (id: string) => {
  const normalizedId = id.toLowerCase();
  return normalizedId.startsWith("workflow") || normalizedId.startsWith("wf_");
};

const Agent = ({
  userName,
  userId,
  interviewId,
  feedbackId,
  type,
  questions,
}: AgentProps) => {
  const router = useRouter();
  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
  const [messages, setMessages] = useState<SavedMessage[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastMessage, setLastMessage] = useState<string>("");
  const isGeneratingFeedbackRef = useRef(false);
  const hasRedirectedAfterGenerateRef = useRef(false);
  const hasShownEmptyTranscriptWarningRef = useRef(false);

  useEffect(() => {
    const onCallStart = () => {
      setCallStatus(CallStatus.ACTIVE);
    };

    const onCallEnd = () => {
      setCallStatus(CallStatus.FINISHED);
    };

    const onMessage = (message: Message) => {
      if (message.type === "transcript" && message.transcriptType === "final") {
        const newMessage = { role: message.role, content: message.transcript };
        setMessages((prev) => [...prev, newMessage]);
      }
    };

    const onSpeechStart = () => {
      console.log("speech start");
      setIsSpeaking(true);
    };

    const onSpeechEnd = () => {
      console.log("speech end");
      setIsSpeaking(false);
    };

    const onError = (error: unknown) => {
      console.error("Vapi error:", error);
      toast.error(getVapiErrorMessage(error));
      setCallStatus(CallStatus.INACTIVE);
      setIsSpeaking(false);
    };

    const onCallStartFailed = (event: { error?: string }) => {
      console.error("Vapi call start failed:", event);
      toast.error(getVapiErrorMessage(event.error || event));
      setCallStatus(CallStatus.INACTIVE);
      setIsSpeaking(false);
    };

    vapi.on("call-start", onCallStart);
    vapi.on("call-end", onCallEnd);
    vapi.on("message", onMessage);
    vapi.on("speech-start", onSpeechStart);
    vapi.on("speech-end", onSpeechEnd);
    vapi.on("error", onError);
    vapi.on("call-start-failed", onCallStartFailed);

    return () => {
      vapi.off("call-start", onCallStart);
      vapi.off("call-end", onCallEnd);
      vapi.off("message", onMessage);
      vapi.off("speech-start", onSpeechStart);
      vapi.off("speech-end", onSpeechEnd);
      vapi.off("error", onError);
      vapi.off("call-start-failed", onCallStartFailed);
    };
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      setLastMessage(messages[messages.length - 1].content);
    }

    const handleGenerateFeedback = async (messages: SavedMessage[]) => {
      const { success, feedbackId: id, message } = await createFeedback({
        interviewId: interviewId!,
        userId: userId!,
        transcript: messages,
        feedbackId,
      });

      if (success && id) {
        router.push(`/interview/${interviewId}/feedback`);
      } else {
        toast.error(message || "Error saving feedback.");
        isGeneratingFeedbackRef.current = false;
      }
    };

    if (callStatus === CallStatus.FINISHED) {
      if (type === "generate") {
        if (hasRedirectedAfterGenerateRef.current) return;
        hasRedirectedAfterGenerateRef.current = true;
        router.push("/");
        router.refresh();
        return;
      }

      if (!messages.length) {
        if (!hasShownEmptyTranscriptWarningRef.current) {
          toast.error("No transcript was captured. Please retake the interview.");
          hasShownEmptyTranscriptWarningRef.current = true;
        }
        return;
      }

      if (!interviewId || !userId) {
        toast.error("Missing interview details. Please try again.");
        return;
      }

      if (!isGeneratingFeedbackRef.current) {
        isGeneratingFeedbackRef.current = true;
        handleGenerateFeedback(messages);
      }
    }
  }, [messages, callStatus, feedbackId, interviewId, router, type, userId]);

  const startGenerateCall = async () => {
    const variableValues = {
      username: userName,
      userid: userId,
    };
    const workflowId = process.env.NEXT_PUBLIC_VAPI_WORKFLOW_ID;
    const assistantId = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;
    const assistantOverrides = {
      variableValues,
      transcriber: interviewTranscriber,
    };

    if (workflowId) {
      return vapi.start(
        undefined,
        undefined,
        undefined,
        workflowId,
        { variableValues }
      );
    }

    if (assistantId && isProbablyWorkflowId(assistantId)) {
      return vapi.start(
        undefined,
        undefined,
        undefined,
        assistantId,
        { variableValues }
      );
    }

    if (assistantId) {
      return vapi.start(assistantId, assistantOverrides);
    }

    throw new Error(
      "Missing NEXT_PUBLIC_VAPI_WORKFLOW_ID or NEXT_PUBLIC_VAPI_ASSISTANT_ID."
    );
  };

  const handleCall = async () => {
    setCallStatus(CallStatus.CONNECTING);
    setMessages([]);
    setLastMessage("");
    isGeneratingFeedbackRef.current = false;
    hasRedirectedAfterGenerateRef.current = false;
    hasShownEmptyTranscriptWarningRef.current = false;

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      if (!userId) {
        throw new Error("You need to be signed in to start an interview.");
      }

      if (!process.env.NEXT_PUBLIC_VAPI_WEB_TOKEN) {
        throw new Error("Missing NEXT_PUBLIC_VAPI_WEB_TOKEN.");
      }

      if (type === "generate") {
        const call = await startGenerateCall();
        if (!call) {
          throw new Error(
            "Vapi could not start the interview generation call. Check your Vapi workflow or assistant ID."
          );
        }
      } else {
        if (!questions?.length) {
          throw new Error("No interview questions were found.");
        }

        const formattedQuestions = questions
          .map((question) => `- ${question}`)
          .join("\n");

        const call = await vapi.start(interviewer, {
          variableValues: {
            questions: formattedQuestions,
          },
          transcriber: interviewTranscriber,
        });

        if (!call) {
          throw new Error("Vapi could not start the interview call.");
        }
      }
    } catch (error) {
      console.error("Error starting call:", error);
      toast.error(getVapiErrorMessage(error));
      setCallStatus(CallStatus.INACTIVE);
    }
  };

  const handleDisconnect = () => {
    try {
      vapi.stop();
    } catch (error) {
      console.error("Error ending call:", error);
    } finally {
      setCallStatus(CallStatus.FINISHED);
      setIsSpeaking(false);
    }
  };

  return (
    <>
      <div className="call-view">
        {/* AI Interviewer Card */}
        <div className="card-interviewer">
          <div className="avatar">
            <Image
              src="/ai-avatar.png"
              alt="profile-image"
              width={65}
              height={54}
              className="object-cover"
            />
            {isSpeaking && <span className="animate-speak" />}
          </div>
          <h3>AI Interviewer</h3>
        </div>

        {/* User Profile Card */}
        <div className="card-border">
          <div className="card-content">
            <Image
              src="/user-avatar.png"
              alt="profile-image"
              width={539}
              height={539}
              className="rounded-full object-cover size-[120px]"
            />
            <h3>{userName}</h3>
          </div>
        </div>
      </div>

      {messages.length > 0 && (
        <div className="transcript-border">
          <div className="transcript">
            <p
              key={lastMessage}
              className={cn(
                "transition-opacity duration-500 opacity-0",
                "animate-fadeIn opacity-100"
              )}
            >
              {lastMessage}
            </p>
          </div>
        </div>
      )}

      <div className="w-full flex justify-center">
        {callStatus !== "ACTIVE" ? (
          <button
            className="relative btn-call disabled:opacity-70 disabled:cursor-not-allowed"
            onClick={() => handleCall()}
            disabled={callStatus === CallStatus.CONNECTING}
          >
            <span
              className={cn(
                "absolute animate-ping rounded-full opacity-75",
                callStatus !== "CONNECTING" && "hidden"
              )}
            />

            <span className="relative">
              {callStatus === "INACTIVE" || callStatus === "FINISHED"
                ? "Call"
                : ". . ."}
            </span>
          </button>
        ) : (
          <button className="btn-disconnect" onClick={() => handleDisconnect()}>
            End
          </button>
        )}
      </div>
    </>
  );
};

export default Agent;
