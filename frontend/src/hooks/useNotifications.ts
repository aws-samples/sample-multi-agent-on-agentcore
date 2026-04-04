import { useState, useCallback } from "react";
import type { Notification } from "../types";

let notifCounter = 0;

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = useCallback(
    (message: string, agent?: string, type: "info" | "error" = "info") => {
      const notif: Notification = {
        id: `notif-${++notifCounter}`,
        message,
        agent,
        timestamp: Date.now(),
        type,
      };
      setNotifications((prev) => [...prev, notif]);
    },
    []
  );

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  return { notifications, addNotification, clearNotifications };
}
