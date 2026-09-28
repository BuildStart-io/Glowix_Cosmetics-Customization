import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useStaffAccess } from "@/hooks/useStaffAccess";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Search,
  User,
  Send,
  Loader2,
  Phone,
  ArrowLeft,
  Bot,
  HandMetal,
  Trash2,
  Crosshair,
  ShoppingBag,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useSearchParams } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Message {
  id: string;
  phone_number: string;
  message: string;
  direction: string;
  message_type: string | null;
  metadata: any;
  created_at: string;
}

interface ChatThread {
  phone_number: string;
  last_message: string;
  last_time: string;
  sender_name: string;
  unread_count: number;
}

interface TrackedPhone {
  phone_number: string;
  faq_questions: string[];
}

interface CustomerOrderSummary {
  order_id: string;
  status: string;
  total_amount: number;
  is_preorder: boolean;
  customer_name: string;
  items_summary: string;
  created_at: string;
  order_count: number;
}

function normalizePhoneKey(raw: string): string {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("94") && digits.length === 11) {
    return digits;
  }
  if (digits.startsWith("0") && digits.length === 10) {
    return "94" + digits.slice(1);
  }
  if (digits.length === 9 && (digits.startsWith("7") || digits.startsWith("1"))) {
    return "94" + digits;
  }
  return digits;
}

export default function Conversations() {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [takenOverChats, setTakenOverChats] = useState<Set<string>>(new Set());
  const [togglingTakeover, setTogglingTakeover] = useState(false);
  const [trackedPhones, setTrackedPhones] = useState<Map<string, string[]>>(new Map());
  const [customerOrders, setCustomerOrders] = useState<Map<string, CustomerOrderSummary>>(new Map());
  const [chatFilter, setChatFilter] = useState<"all" | "orders" | "queries">("all");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const { effectiveUserId } = useStaffAccess();
  const [searchParams, setSearchParams] = useSearchParams();

  // Fetch customer orders to identify confirmed buyers
  const fetchCustomerOrders = useCallback(async () => {
    if (!user) return;
    try {
      const ownerId = effectiveUserId || user.id;
      const { data, error } = await supabase
        .from("orders")
        .select("id, whatsapp_phone, customer_phone, customer_name, status, total_amount, is_preorder, order_items, created_at")
        .eq("user_id", ownerId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching customer orders for conversations:", error);
        return;
      }

      if (data) {
        const orderMap = new Map<string, CustomerOrderSummary>();
        for (const o of data) {
          const wKey = normalizePhoneKey(o.whatsapp_phone);
          const cKey = normalizePhoneKey(o.customer_phone);
          const rawW = o.whatsapp_phone?.trim();
          const rawC = o.customer_phone?.trim();

          const itemsText = Array.isArray(o.order_items)
            ? o.order_items.map((i: any) => `${i.name || "Item"}${i.quantity ? ` x${i.quantity}` : ""}`).join(", ")
            : "";

          const summary: CustomerOrderSummary = {
            order_id: o.id,
            status: o.status,
            total_amount: Number(o.total_amount) || 0,
            is_preorder: Boolean(o.is_preorder),
            customer_name: o.customer_name || "",
            items_summary: itemsText,
            created_at: o.created_at,
            order_count: 1,
          };

          const keysToMap = [wKey, cKey, rawW, rawC].filter(Boolean);
          for (const k of keysToMap) {
            if (!orderMap.has(k)) {
              orderMap.set(k, summary);
            } else {
              const existing = orderMap.get(k)!;
              existing.order_count += 1;
            }
          }
        }
        setCustomerOrders(orderMap);
      }
    } catch (err) {
      console.error("Error in fetchCustomerOrders:", err);
    }
  }, [user, effectiveUserId]);

  // Fetch tracked FAQ usage phones
  const fetchTrackedPhones = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from("faq_usage_logs" as any)
        .select("phone_number, faq_id, faqs!inner(question)")
        .order("created_at", { ascending: false });

      if (data) {
        const phoneMap = new Map<string, string[]>();
        for (const row of data as any[]) {
          const phone = row.phone_number;
          const question = row.faqs?.question || "Unknown FAQ";
          if (!phoneMap.has(phone)) {
            phoneMap.set(phone, []);
          }
          const existing = phoneMap.get(phone)!;
          if (!existing.includes(question)) {
            existing.push(question);
          }
        }
        setTrackedPhones(phoneMap);
      }
    } catch (err) {
      console.error("Error fetching tracked phones:", err);
    }
  }, [user]);

  // Auto-select phone from URL query param
  useEffect(() => {
    const phoneParam = searchParams.get("phone");
    if (phoneParam && !selectedPhone) {
      setSelectedPhone(phoneParam);
      fetchMessages(phoneParam);
      // Clean up the URL
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);

  // Fetch all takeover states for the user
  const fetchTakeovers = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("chat_takeovers" as any)
      .select("phone_number")
      .eq("user_id", user.id)
      .eq("is_taken_over", true);
    if (data) {
      setTakenOverChats(new Set((data as any[]).map((d: any) => d.phone_number)));
    }
  }, [user]);

  useEffect(() => {
    fetchTakeovers();
    fetchTrackedPhones();
    fetchCustomerOrders();
  }, [fetchTakeovers, fetchTrackedPhones, fetchCustomerOrders]);

  // Realtime subscription for orders
  useEffect(() => {
    const ordersChannel = supabase
      .channel("orders-conversations-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "glowix_cosmetics", table: "orders" },
        () => {
          fetchCustomerOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ordersChannel);
    };
  }, [fetchCustomerOrders]);

  const toggleTakeover = useCallback(async (phoneNumber: string) => {
    if (!user || togglingTakeover) return;
    setTogglingTakeover(true);
    try {
      const isTakenOver = takenOverChats.has(phoneNumber);
      if (isTakenOver) {
        await (supabase.from("chat_takeovers" as any) as any)
          .delete()
          .eq("user_id", effectiveUserId || user.id)
          .eq("phone_number", phoneNumber);
        setTakenOverChats(prev => {
          const next = new Set(prev);
          next.delete(phoneNumber);
          return next;
        });
        toast({ title: "Bot re-enabled for this chat" });
      } else {
        await (supabase.from("chat_takeovers" as any) as any)
          .upsert({
            user_id: effectiveUserId || user.id,
            phone_number: phoneNumber,
            is_taken_over: true,
          }, { onConflict: "user_id,phone_number" });
        setTakenOverChats(prev => new Set(prev).add(phoneNumber));
        toast({ title: "Bot paused — you're in control" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setTogglingTakeover(false);
    }
  }, [user, takenOverChats, togglingTakeover, toast]);

  const deleteThread = async (phoneNumber: string) => {
    try {
      const { error } = await supabase
        .from("conversations")
        .delete()
        .eq("phone_number", phoneNumber);
      if (error) throw error;
      await (supabase.from("chat_takeovers" as any) as any)
        .delete()
        .eq("phone_number", phoneNumber);
      if (selectedPhone === phoneNumber) {
        setSelectedPhone(null);
        setMessages([]);
      }
      setThreads((prev) => prev.filter((t) => t.phone_number !== phoneNumber));
      toast({ title: "Conversation deleted" });
    } catch (error: any) {
      toast({ title: "Error deleting conversation", description: error.message, variant: "destructive" });
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchThreads = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const threadMap = new Map<string, ChatThread>();
      (data || []).forEach((msg) => {
        const existing = threadMap.get(msg.phone_number);
        const senderName =
          msg.direction === "inbound"
            ? (msg.metadata as any)?.senderName || "Unknown"
            : "";

        if (!existing) {
          threadMap.set(msg.phone_number, {
            phone_number: msg.phone_number,
            last_message: msg.message,
            last_time: msg.created_at,
            sender_name: senderName || "Unknown",
            unread_count: 0,
          });
        } else if (senderName && existing.sender_name === "Unknown") {
          existing.sender_name = senderName;
        }
      });

      setThreads(Array.from(threadMap.values()));
    } catch (error: any) {
      console.error("Error fetching threads:", error);
      toast({
        title: "Error loading conversations",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchMessages = useCallback(
    async (phoneNumber: string) => {
      setMessagesLoading(true);
      try {
        const { data, error } = await supabase
          .from("conversations")
          .select("*")
          .eq("phone_number", phoneNumber)
          .order("created_at", { ascending: true });

        if (error) throw error;
        setMessages(data || []);
        setTimeout(scrollToBottom, 100);
      } catch (error: any) {
        toast({
          title: "Error loading messages",
          description: error.message,
          variant: "destructive",
        });
      } finally {
        setMessagesLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  // Realtime subscription for new messages
  useEffect(() => {
    const channel = supabase
      .channel("conversations-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "glowix_cosmetics", table: "conversations" },
        (payload) => {
          const newMsg = payload.new as Message;

          setThreads((prev) => {
            const existing = prev.find(
              (t) => t.phone_number === newMsg.phone_number
            );
            if (existing) {
              return prev.map((t) =>
                t.phone_number === newMsg.phone_number
                  ? {
                      ...t,
                      last_message: newMsg.message,
                      last_time: newMsg.created_at,
                    }
                  : t
              );
            }
            return [
              {
                phone_number: newMsg.phone_number,
                last_message: newMsg.message,
                last_time: newMsg.created_at,
                sender_name:
                  (newMsg.metadata as any)?.senderName || "Unknown",
                unread_count: 0,
              },
              ...prev,
            ];
          });

          if (newMsg.phone_number === selectedPhone) {
            setMessages((prev) => [...prev, newMsg]);
            setTimeout(scrollToBottom, 100);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedPhone]);

  const handleSelectThread = (phoneNumber: string) => {
    setSelectedPhone(phoneNumber);
    fetchMessages(phoneNumber);
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedPhone || sending) return;

    setSending(true);
    try {
      const ownerId = effectiveUserId || user!.id;
      const { data: sessionData, error: sessionError } = await supabase
        .from("user_wsender_sessions" as any)
        .select("session_api_key, session_id")
        .eq("user_id", ownerId)
        .limit(1)
        .maybeSingle();

      if (sessionError) throw sessionError;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-whatsapp-Glowix_cosmetics`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: selectedPhone,
            message: replyText,
            sessionApiKey: (sessionData as any)?.session_api_key || (sessionData as any)?.session_id,
          }),
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to send message");
      }

      await supabase.from("conversations").insert({
        phone_number: selectedPhone,
        message: replyText,
        direction: "outbound",
        message_type: "text",
        user_id: ownerId,
      });

      setReplyText("");
      toast({ title: "Message sent" });
    } catch (error: any) {
      toast({
        title: "Error sending message",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const formatWhatsAppText = (text: string) => {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*(.+?)\*/g, '<strong>$1</strong>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/~(.+?)~/g, '<del>$1</del>');
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = diff / (1000 * 60 * 60);

    if (hours < 24) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    if (hours < 48) return "Yesterday";
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const getOrderForPhone = (phone: string): CustomerOrderSummary | undefined => {
    const normalized = normalizePhoneKey(phone);
    return customerOrders.get(normalized) || customerOrders.get(phone);
  };

  const ordersThreadCount = threads.filter(t => Boolean(getOrderForPhone(t.phone_number))).length;
  const queriesThreadCount = Math.max(0, threads.length - ordersThreadCount);

  const filteredThreads = threads.filter((t) => {
    const matchesSearch =
      t.phone_number.includes(searchQuery) ||
      t.sender_name.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    const hasOrder = Boolean(getOrderForPhone(t.phone_number));
    if (chatFilter === "orders") return hasOrder;
    if (chatFilter === "queries") return !hasOrder;
    return true;
  });

  const selectedOrder = selectedPhone ? getOrderForPhone(selectedPhone) : undefined;

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-7rem)] lg:h-[calc(100vh-8rem)] flex flex-col">
        <div className={cn("mb-4", selectedPhone && "hidden md:block")}>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Conversations</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            WhatsApp chat history and live messages
          </p>
        </div>

        <Card className="flex-1 flex overflow-hidden">
          {/* Thread List */}
          <div
            className={cn(
              "w-full md:w-80 border-r flex flex-col",
              selectedPhone ? "hidden md:flex" : "flex"
            )}
          >
            <div className="p-3 border-b space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search chats..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Segment Filter Buttons: All, Orders, Queries */}
              <div className="grid grid-cols-3 gap-1 bg-muted/60 p-1 rounded-lg text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setChatFilter("all")}
                  className={cn(
                    "py-1.5 px-2 rounded-md transition-all text-center flex items-center justify-center gap-1",
                    chatFilter === "all"
                      ? "bg-background shadow-sm text-foreground font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span>All</span>
                  <span className="text-[10px] px-1.5 py-0.2 bg-muted rounded-full font-mono">
                    {threads.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setChatFilter("orders")}
                  className={cn(
                    "py-1.5 px-2 rounded-md transition-all text-center flex items-center justify-center gap-1",
                    chatFilter === "orders"
                      ? "bg-emerald-600 text-white shadow-sm font-semibold"
                      : "text-emerald-700 dark:text-emerald-400 hover:text-emerald-800"
                  )}
                >
                  <ShoppingBag className="h-3 w-3" />
                  <span>Orders</span>
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.2 rounded-full font-mono",
                    chatFilter === "orders" ? "bg-emerald-700 text-white" : "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                  )}>
                    {ordersThreadCount}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setChatFilter("queries")}
                  className={cn(
                    "py-1.5 px-2 rounded-md transition-all text-center flex items-center justify-center gap-1",
                    chatFilter === "queries"
                      ? "bg-background shadow-sm text-foreground font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <MessageSquare className="h-3 w-3" />
                  <span>Queries</span>
                  <span className="text-[10px] px-1.5 py-0.2 bg-muted rounded-full font-mono">
                    {queriesThreadCount}
                  </span>
                </button>
              </div>
            </div>
            <ScrollArea className="flex-1">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredThreads.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {chatFilter === "orders" ? "No orders found in chats" : chatFilter === "queries" ? "No query chats found" : "No conversations yet"}
                  </p>
                </div>
              ) : (
                <TooltipProvider>
                  {filteredThreads.map((thread) => {
                    const isTracked = trackedPhones.has(thread.phone_number);
                    const trackedFaqs = trackedPhones.get(thread.phone_number) || [];
                    const order = getOrderForPhone(thread.phone_number);
                    const hasOrder = Boolean(order);
                    
                    return (
                      <button
                        key={thread.phone_number}
                        onClick={() => handleSelectThread(thread.phone_number)}
                        className={cn(
                          "w-full text-left px-4 py-3 border-b hover:bg-muted/50 transition-colors relative",
                          selectedPhone === thread.phone_number && "bg-muted",
                          hasOrder && "border-l-4 border-l-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/20",
                          !hasOrder && isTracked && "border-l-4 border-l-primary bg-primary/5"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex flex-col items-center gap-1 flex-shrink-0">
                            <div className={cn(
                              "h-10 w-10 rounded-full flex items-center justify-center transition-all",
                              hasOrder
                                ? "bg-emerald-100 dark:bg-emerald-900/60 ring-2 ring-emerald-500 text-emerald-700 dark:text-emerald-300"
                                : isTracked
                                  ? "bg-primary/20 ring-2 ring-primary text-primary"
                                  : "bg-primary/10 text-primary"
                            )}>
                              {hasOrder ? (
                                <ShoppingBag className="h-5 w-5" />
                              ) : (
                                <User className="h-5 w-5" />
                              )}
                            </div>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <span
                                  role="button"
                                  onClick={(e) => e.stopPropagation()}
                                  className="p-1.5 rounded hover:bg-destructive/10 text-destructive/60 hover:text-destructive transition-colors cursor-pointer"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </span>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Conversation</AlertDialogTitle>
                                  <AlertDialogDescription>This will permanently delete all messages with {thread.phone_number}. This action cannot be undone.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteThread(thread.phone_number)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                <p className={cn(
                                  "font-medium text-sm truncate",
                                  hasOrder ? "text-emerald-900 dark:text-emerald-200 font-semibold" : isTracked && "text-primary font-bold"
                                )}>
                                  {thread.sender_name}
                                </p>
                                {hasOrder && (
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-[10px] px-1.5 py-0 border-emerald-400 font-medium flex items-center gap-1",
                                      order.is_preorder
                                        ? "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300"
                                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200"
                                    )}
                                  >
                                    <ShoppingBag className="h-2.5 w-2.5" />
                                    <span>{order.is_preorder ? "Pre-Order" : "Order"}</span>
                                    <span>• LKR {order.total_amount.toLocaleString()}</span>
                                  </Badge>
                                )}
                                {isTracked && !hasOrder && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span>
                                        <Crosshair className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="max-w-xs">
                                      <p className="font-medium text-xs mb-1">Triggered tracked FAQs:</p>
                                      <ul className="text-xs space-y-0.5">
                                        {trackedFaqs.map((q, i) => (
                                          <li key={i} className="truncate">• {q}</li>
                                        ))}
                                      </ul>
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                                {formatTime(thread.last_time)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground mt-0.5">
                              <p className="flex items-center gap-1 truncate">
                                <Phone className="h-3 w-3 flex-shrink-0" />
                                <span>{thread.phone_number}</span>
                              </p>
                              {hasOrder && (
                                <span className={cn(
                                  "text-[10px] px-1.5 py-0.2 rounded font-medium capitalize flex-shrink-0 ml-1",
                                  order.status === "completed"
                                    ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300"
                                    : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                                )}>
                                  {order.status}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground truncate mt-0.5">
                              {thread.last_message}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </TooltipProvider>
              )}
            </ScrollArea>
          </div>

          {/* Chat Area */}
          <div
            className={cn(
              "flex-1 flex flex-col",
              !selectedPhone ? "hidden md:flex" : "flex"
            )}
          >
            {selectedPhone ? (
              <>
                {/* Chat Header */}
                <div className="flex items-center gap-3 p-4 border-b bg-card">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    onClick={() => setSelectedPhone(null)}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <div className={cn(
                    "h-9 w-9 rounded-full flex items-center justify-center transition-all",
                    selectedOrder
                      ? "bg-emerald-100 dark:bg-emerald-900/60 ring-2 ring-emerald-500 text-emerald-700 dark:text-emerald-300"
                      : trackedPhones.has(selectedPhone)
                        ? "bg-primary/20 ring-2 ring-primary text-primary"
                        : "bg-primary/10 text-primary"
                  )}>
                    {selectedOrder ? (
                      <ShoppingBag className="h-5 w-5" />
                    ) : (
                      <User className="h-5 w-5 text-primary" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={cn(
                        "font-medium text-sm",
                        selectedOrder ? "text-emerald-900 dark:text-emerald-200 font-semibold" : trackedPhones.has(selectedPhone) && "text-primary font-bold"
                      )}>
                        {threads.find((t) => t.phone_number === selectedPhone)
                          ?.sender_name || "Unknown"}
                      </p>
                      {selectedOrder && (
                        <Badge variant="outline" className="gap-1 text-xs border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                          <ShoppingBag className="h-3 w-3" />
                          <span>{selectedOrder.is_preorder ? "Pre-Order" : "Order Placed"}: LKR {selectedOrder.total_amount.toLocaleString()}</span>
                          <span className="capitalize">({selectedOrder.status})</span>
                        </Badge>
                      )}
                      {trackedPhones.has(selectedPhone) && !selectedOrder && (
                        <Badge variant="outline" className="gap-1 text-xs border-primary/50 text-primary">
                          <Crosshair className="h-3 w-3" />
                          FAQ Tracked
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedPhone}
                    </p>
                  </div>
                  <Button
                    variant={takenOverChats.has(selectedPhone) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleTakeover(selectedPhone)}
                    disabled={togglingTakeover}
                    className="gap-1.5"
                  >
                    {takenOverChats.has(selectedPhone) ? (
                      <>
                        <HandMetal className="h-4 w-4" />
                        <span className="hidden sm:inline">Taken Over</span>
                      </>
                    ) : (
                      <>
                        <Bot className="h-4 w-4" />
                        <span className="hidden sm:inline">Bot Active</span>
                      </>
                    )}
                  </Button>
                </div>

                {/* Mini Order Alert Banner */}
                {selectedOrder && (
                  <div className="bg-emerald-50/90 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-800/40 px-4 py-2 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1 flex-shrink-0">
                        <ShoppingBag className="h-3.5 w-3.5" />
                        Order Details:
                      </span>
                      <span className="text-muted-foreground truncate">
                        {selectedOrder.items_summary || "Items ordered"}
                      </span>
                      <span className="font-mono font-bold text-foreground flex-shrink-0">
                        LKR {selectedOrder.total_amount.toLocaleString()}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize flex-shrink-0">
                        {selectedOrder.status}
                      </Badge>
                    </div>
                    <a
                      href="/dashboard/orders"
                      className="text-emerald-700 dark:text-emerald-400 font-medium hover:underline flex items-center gap-1 flex-shrink-0 ml-3"
                    >
                      <span>View Orders</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}

                {/* Messages */}
                <ScrollArea className="flex-1 p-4">
                  {messagesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {messages.map((msg) => (
                        <div
                          key={msg.id}
                          className={cn(
                            "flex",
                            msg.direction === "outbound"
                              ? "justify-end"
                              : "justify-start"
                          )}
                        >
                          <div
                            className={cn(
                              "max-w-[75%] rounded-2xl px-4 py-2 text-sm",
                              msg.direction === "outbound"
                                ? "bg-primary text-primary-foreground rounded-br-md"
                                : "bg-muted rounded-bl-md"
                            )}
                          >
                            <p className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: formatWhatsAppText(msg.message) }} />
                            <p
                              className={cn(
                                "text-[10px] mt-1",
                                msg.direction === "outbound"
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground"
                              )}
                            >
                              {new Date(msg.created_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </ScrollArea>

                {/* Reply Input */}
                <div className="p-3 border-t bg-card">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendReply();
                    }}
                    className="flex gap-2"
                  >
                    <Input
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Type a message..."
                      className="flex-1"
                      disabled={sending}
                    />
                    <Button
                      type="submit"
                      size="icon"
                      disabled={!replyText.trim() || sending}
                    >
                      {sending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </form>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <MessageSquare className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                  <p className="text-lg font-medium text-muted-foreground">
                    Select a conversation
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Choose a chat from the list to view messages
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
