"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { vapi } from "@/lib/vapi.sdk";
import { interviewer } from "@/constants";
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

    const onError = (error: Error) => {
      console.error("Vapi error:", error);
      toast.error("The call failed. Please check your microphone and try again.");
      setCallStatus(CallStatus.INACTIVE);
      setIsSpeaking(false);
    };

    vapi.on("call-start", onCallStart);
    vapi.on("call-end", onCallEnd);
    vapi.on("message", onMessage);
    vapi.on("speech-start", onSpeechStart);
    vapi.on("speech-end", onSpeechEnd);
    vapi.on("error", onError);

    return () => {
      vapi.off("call-start", onCallStart);
      vapi.off("call-end", onCallEnd);
      vapi.off("message", onMessage);
      vapi.off("speech-start", onSpeechStart);
      vapi.off("speech-end", onSpeechEnd);
      vapi.off("error", onError);
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

  const requestMicrophoneAccess = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (error) {
      console.error("Microphone permission denied:", error);
      toast.error("Microphone access is required to start the interview.");
      return false;
    }
  };

  const handleCall = async () => {
    setCallStatus(CallStatus.CONNECTING);
    setMessages([]);
    setLastMessage("");
    isGeneratingFeedbackRef.current = false;
    hasRedirectedAfterGenerateRef.current = false;
    hasShownEmptyTranscriptWarningRef.current = false;

    try {
      if (!userId) {
        throw new Error("You need to be signed in to start an interview.");
      }

      const hasMicrophoneAccess = await requestMicrophoneAccess();
      if (!hasMicrophoneAccess) {
        setCallStatus(CallStatus.INACTIVE);
        return;
      }

      if (type === "generate") {
        const assistantId = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;
        if (!assistantId) {
          throw new Error("Missing NEXT_PUBLIC_VAPI_ASSISTANT_ID.");
        }

        await vapi.start(assistantId, {
          variableValues: {
            username: userName,
            userid: userId,
          },
        });
      } else {
        if (!questions?.length) {
          throw new Error("No interview questions were found.");
        }

        const formattedQuestions = questions
          .map((question) => `- ${question}`)
          .join("\n");

        await vapi.start(interviewer, {
          variableValues: {
            questions: formattedQuestions,
          },
        });
      }
    } catch (error) {
      console.error("Error starting call:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to start the call. Please try again."
      );
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
          <button className="relative btn-call" onClick={() => handleCall()}>
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
