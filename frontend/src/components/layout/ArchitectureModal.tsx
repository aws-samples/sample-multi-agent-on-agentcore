"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

interface ArchitectureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ArchitectureModal({ isOpen, onClose }: ArchitectureModalProps) {
  // ESC key to close
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleEsc);
      // Prevent body scroll
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-[95vw] h-[95vh] bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-purple-50">
          <h2 className="text-xl font-bold text-gray-800">
            Architecture Overview
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/50 transition-colors text-gray-600 hover:text-gray-900"
            title="Close (ESC)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* SVG Content */}
        <div className="w-full h-[calc(100%-73px)] overflow-auto p-6 bg-gray-50">
          <div className="flex items-center justify-center min-h-full">
            <img
              src="/overview.svg"
              alt="Architecture Diagram"
              className="max-w-full h-auto"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
