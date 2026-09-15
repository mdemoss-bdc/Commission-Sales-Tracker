"use client";

import { useSyncExternalStore } from "react";
import { getSessionUser, onAuthUserChange } from "@/lib/auth-session";
import {
  loadUserNotifications,
  markNotificationRead,
  mergeNotification,
  parseUserNotification,
  unreadNotifications,
  type UserNotification,
} from "@/lib/notifications";
import { getSupabase } from "@/lib/supabase";

type NotificationSnapshot = {
  ready: boolean;
  rows: UserNotification[];
};

const empty: NotificationSnapshot = { ready: false, rows: [] };
const listeners = new Set<() => void>();
let snapshot: NotificationSnapshot = empty;
let started = false;
let subscribedUserId: string | null = null;
let channel: ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function refreshNotifications(userId: string) {
  const rows = await loadUserNotifications(userId);
  if (getSessionUser()?.id !== userId) return;
  snapshot = { ready: true, rows };
  emit();
}

function applyRealtimeRow(raw: unknown) {
  const row = parseUserNotification(raw);
  if (!row) return;
  snapshot = { ready: true, rows: mergeNotification(snapshot.rows, row) };
  emit();
}

function stopRealtime() {
  const supabase = getSupabase();
  if (channel && supabase) {
    void supabase.removeChannel(channel);
  }
  channel = null;
  subscribedUserId = null;
}

function startRealtime(userId: string) {
  const supabase = getSupabase();
  if (!supabase) return;
  if (subscribedUserId === userId && channel) return;
  stopRealtime();
  subscribedUserId = userId;
  channel = supabase
    .channel(`user-notifications-${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "user_notifications",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (payload.new) applyRealtimeRow(payload.new);
      },
    )
    .subscribe();
}

function boot() {
  if (started) return;
  started = true;
  onAuthUserChange((user) => {
    stopRealtime();
    if (!user) {
      snapshot = { ready: true, rows: [] };
      emit();
      return;
    }
    snapshot = { ready: false, rows: [] };
    emit();
    startRealtime(user.id);
    void refreshNotifications(user.id);
  });
  const user = getSessionUser();
  if (!user) {
    snapshot = { ready: true, rows: [] };
    emit();
    return;
  }
  startRealtime(user.id);
  void refreshNotifications(user.id);
}

export function useUserNotifications() {
  boot();
  const state = useSyncExternalStore(subscribe, () => snapshot, () => empty);
  const unread = unreadNotifications(state.rows);
  return {
    ready: state.ready,
    rows: state.rows,
    unread,
    unreadCount: unread.length,
    latestUnread: unread[0] ?? null,
  };
}

export async function dismissNotification(id: string): Promise<string | null> {
  const error = await markNotificationRead(id);
  const current = snapshot.rows.find((row) => row.id === id);
  if (!error && current) {
    snapshot = {
      ready: true,
      rows: mergeNotification(snapshot.rows, { ...current, is_read: true }),
    };
    emit();
  }
  return error;
}
