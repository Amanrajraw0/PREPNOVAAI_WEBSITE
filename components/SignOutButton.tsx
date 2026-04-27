"use client";

import { LogOut } from "lucide-react";
import { signOut as firebaseSignOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { auth } from "@/firebase/client";
import { signOut } from "@/lib/actions/auth.action";
import { Button } from "@/components/ui/button";

const SignOutButton = () => {
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      await Promise.all([firebaseSignOut(auth), signOut()]);
      toast.success("Signed out successfully.");
      router.push("/sign-in");
      router.refresh();
    } catch (error) {
      console.error("Error signing out:", error);
      toast.error("Could not sign out. Please try again.");
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleSignOut}
      className="text-light-100 hover:text-primary-100 hover:bg-dark-200"
      aria-label="Sign out"
    >
      <LogOut className="size-4" />
      <span className="max-sm:hidden">Sign out</span>
    </Button>
  );
};

export default SignOutButton;
