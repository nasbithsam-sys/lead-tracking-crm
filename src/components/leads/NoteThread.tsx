import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Send, Pencil, Check, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

interface LeadNote {
  id: string;
  lead_id: string;
  user_id: string | null;
  user_name?: string | null;
  note_type: string;
  content: string;
  created_at: string;
}

interface Props {
  leadId: string;
  noteType: "cs" | "processor" | "general" | "opr";
  label: string;
  profiles?: Record<string, string>;
  onNotesChanged?: () => void;
}

export default function NoteThread({ leadId, noteType, label, profiles = {}, onNotesChanged }: Props) {
  const { user, role, profile } = useAuth();
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [resolvedProfiles, setResolvedProfiles] = useState<Record<string, string>>({});
  const [newNote, setNewNote] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const isAdmin = role === "admin";
  const isCS = role === "customer_service";
  const isCsAdmin = role === "cs_admin";
  const isProcessor = role === "processor";
  const isOpr = role === "opr";

  const canViewThread = useMemo(() => {
    if (isAdmin) return true;
    if (noteType === "general") return true;
    if (noteType === "cs") return isCS || isCsAdmin || isProcessor;
    if (noteType === "opr") return isProcessor || isOpr;
    return isProcessor;
  }, [isAdmin, isCS, isCsAdmin, isProcessor, isOpr, noteType]);

  const canWriteThread = useMemo(() => {
    if (isAdmin) return true;
    if (noteType === "general") return true;
    if (noteType === "cs") return isCS || isCsAdmin;
    if (noteType === "opr") return isProcessor || isOpr;
    return isProcessor;
  }, [isAdmin, isCS, isCsAdmin, isProcessor, isOpr, noteType]);

  const fetchNotes = useCallback(async () => {
    if (!canViewThread) {
      setNotes([]);
      return;
    }

    const { data } = await supabase
      .from("lead_notes")
      .select("*")
      .eq("lead_id", leadId)
      .eq("note_type", noteType)
      .order("created_at", { ascending: true });
    if (data) setNotes(data as LeadNote[]);
  }, [canViewThread, leadId, noteType]);

  useEffect(() => {
    void fetchNotes();
  }, [fetchNotes]);

  // Realtime subscription for notes
  useEffect(() => {
    if (!canViewThread) return;

    const channel = supabase
      .channel(`notes:${leadId}:${noteType}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lead_notes",
          filter: `lead_id=eq.${leadId}`,
        },
        (payload) => {
          // Only fetch if it matches our noteType (Supabase realtime filters only support single column, so we check note_type here)
          const newRow = payload.new as { note_type?: string };
          const oldRow = payload.old as { note_type?: string };
          
          if (newRow?.note_type === noteType || oldRow?.note_type === noteType) {
            void fetchNotes();
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [canViewThread, fetchNotes, leadId, noteType]);

  const profilesKey = JSON.stringify(profiles);

  useEffect(() => {
    const missingUserIds = Array.from(new Set(notes.map((note) => note.user_id).filter(Boolean) as string[])).filter((userId) => !profiles[userId]);

    if (missingUserIds.length === 0) {
      setResolvedProfiles({});
      return;
    }

    let cancelled = false;

    const fetchProfileNames = async () => {
      const { data } = await supabase.from("profiles_public" as never).select("id, full_name").in("id", missingUserIds) as { data: { id: string; full_name: string | null }[] | null };

      if (!cancelled && data) {
        const nextProfiles = Object.fromEntries(
          data.map((profile: { id: string; full_name: string | null }) => [profile.id, profile.full_name || "Unknown"]),
        );
        setResolvedProfiles(nextProfiles);
      }
    };

    void fetchProfileNames();

    return () => {
      cancelled = true;
    };
  }, [notes, profilesKey]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [notes]);

  const handleSend = async () => {
    if (!canWriteThread || !newNote.trim() || !user) return;
    setSending(true);
    const { error } = await supabase.from("lead_notes").insert({
      lead_id: leadId,
      user_id: user.id,
      user_name: profile?.full_name || user.email || "Unknown user",
      note_type: noteType,
      content: newNote.trim(),
    });
    if (error) {
      toast.error("Failed to add note: " + error.message);
    } else {
      setNewNote("");
      await fetchNotes();
      onNotesChanged?.();
    }
    setSending(false);
  };

  const handleEdit = (note: LeadNote) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const handleSaveEdit = async () => {
    if (!editContent.trim() || !editingId) return;
    const { error } = await supabase
      .from("lead_notes")
      .update({ content: editContent.trim() })
      .eq("id", editingId);
    if (error) {
      toast.error("Failed to update note");
    } else {
      setEditingId(null);
      setEditContent("");
      await fetchNotes();
      onNotesChanged?.();
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canEdit = (note: LeadNote) => {
    if (!canWriteThread) return false;
    if (isAdmin) return true;
    return note.user_id === user?.id;
  };

  const getInitials = (note: LeadNote) => {
    const name = (note.user_id ? profiles[note.user_id] || resolvedProfiles[note.user_id] : null) || note.user_name || "?";
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  };

  const getName = (note: LeadNote) => (note.user_id ? profiles[note.user_id] || resolvedProfiles[note.user_id] : null) || note.user_name || "Unknown";

  if (!canViewThread) return null;

  return (
    <div className="crm-lead-card-soft overflow-hidden rounded-[20px]">
      <div className="border-b border-border/40 bg-[hsl(var(--background)/0.64)] px-4 py-2.5 dark:bg-[hsl(var(--background)/0.18)]">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">{label}</h4>
      </div>

      <div ref={scrollRef} className="max-h-60 space-y-3 overflow-y-auto p-3">
        {notes.length === 0 && (
          <p className="text-[12px] text-muted-foreground/40 text-center py-6">No notes yet. Start the conversation.</p>
        )}
        <AnimatePresence initial={false}>
          {notes.map((note) => {
            const isMe = note.user_id === user?.id;
            const isEditing = editingId === note.id;
            return (
              <motion.div
                key={note.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16 }}
                className={`flex gap-2.5 ${isMe ? "flex-row-reverse" : ""}`}
              >
                <Avatar className="h-6 w-6 shrink-0">
                  <AvatarFallback className={`text-[8px] font-bold ${isMe ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {getInitials(note)}
                  </AvatarFallback>
                </Avatar>
                <div className={`max-w-[75%] space-y-0.5 ${isMe ? "items-end text-right" : ""}`}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-foreground">
                      {getName(note)}
                    </span>
                    <span className="text-[9px] text-muted-foreground/40">
                      {new Date(note.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {canEdit(note) && !isEditing && (
                      <button
                        onClick={() => handleEdit(note)}
                        className="opacity-0 group-hover/note:opacity-100 hover:opacity-100 focus:opacity-100 p-0.5 rounded hover:bg-muted transition-all"
                        title="Edit note"
                      >
                        <Pencil className="h-2.5 w-2.5 text-muted-foreground/60" />
                      </button>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="space-y-1.5">
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="min-h-[60px] text-[13px] resize-none"
                        autoFocus
                      />
                      <div className="flex gap-1 justify-end">
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancelEdit}>
                          <X className="h-3 w-3" />
                        </Button>
                        <Button size="icon" className="h-6 w-6" onClick={handleSaveEdit}>
                          <Check className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`group/note relative rounded-[16px] px-3 py-2 text-[13px] leading-relaxed ${
                        isMe
                          ? "border border-primary/15 bg-[linear-gradient(180deg,hsl(var(--primary)),hsl(223_85%_60%))] text-primary-foreground rounded-tr-sm shadow-[0_12px_22px_-18px_hsl(var(--primary)/0.55)]"
                          : "crm-lead-card-inner rounded-tl-sm text-foreground shadow-[0_14px_22px_-20px_rgba(59,130,246,0.12)] dark:shadow-none"
                      }`}
                    >
                      {note.content}
                      {canEdit(note) && (
                        <button
                          onClick={() => handleEdit(note)}
                          className="absolute top-1 right-1 opacity-0 group-hover/note:opacity-100 p-1 rounded-md hover:bg-black/10 transition-all"
                          title="Edit"
                        >
                          <Pencil className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {canWriteThread ? (
        <div className="flex gap-2 border-t border-border/35 bg-[hsl(var(--background)/0.54)] p-2 dark:bg-[hsl(var(--background)/0.12)]">
          <Textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Add a note...`}
            className="crm-lead-card-inner min-h-[36px] max-h-20 resize-none border-0 bg-transparent text-sm focus-visible:ring-0 shadow-none"
            rows={1}
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0 rounded-[14px] shadow-[0_12px_22px_-16px_hsl(var(--primary)/0.45)]"
            onClick={handleSend}
            disabled={sending || !newNote.trim()}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="border-t border-border/35 bg-[hsl(var(--background)/0.5)] px-4 py-2.5 text-[11px] text-muted-foreground dark:bg-[hsl(var(--background)/0.1)]">
          This note thread is view-only for your role.
        </div>
      )}
    </div>
  );
}
