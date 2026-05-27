import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Copy,
  Plus,
  ReceiptText,
  RotateCcw,
  Share2,
  Trash2,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Participant = {
  id: string;
  name: string;
};

type Expense = {
  id: string;
  description: string;
  amountCents: number;
  payerId: string;
  participantIds: string[];
};

type SplitEvent = {
  id: string;
  name: string;
  participants: Participant[];
  expenses: Expense[];
};

type BillState = {
  events: SplitEvent[];
  activeEventId: string;
};

type LegacyBillState = {
  v?: number;
  participants?: Participant[];
  expenses?: Expense[];
};

type SettlementTransfer = {
  fromId: string;
  toId: string;
  amountCents: number;
};

interface SettleUpPageProps {
  onBackToWork: () => void;
}

const demoParticipants: Participant[] = [
  { id: "wil", name: "Wil" },
  { id: "monette", name: "Monette" },
  { id: "eric", name: "Eric" },
  { id: "crystal", name: "Crystal" },
  { id: "mom", name: "Mom" },
  { id: "dad", name: "Dad" },
  { id: "bella", name: "Bella" },
  { id: "bellas-son", name: "Bella's Son" },
];

const coreSix = ["wil", "monette", "eric", "crystal", "mom", "dad"];
const allEight = [...coreSix, "bella", "bellas-son"];

const demoExpenses: Expense[] = [
  { id: "architecture-river-tour", description: "Architecture River Tour", amountCents: 27000, payerId: "eric", participantIds: coreSix },
  { id: "venteux", description: "Venteux", amountCents: 34254, payerId: "monette", participantIds: coreSix },
  { id: "sushi-nova", description: "Sushi Nova", amountCents: 18360, payerId: "monette", participantIds: coreSix },
  { id: "indian-garden", description: "Indian Garden", amountCents: 15700, payerId: "monette", participantIds: coreSix },
  { id: "wild-berry-pancake", description: "Wild Berry Pancake", amountCents: 11096, payerId: "monette", participantIds: coreSix },
  { id: "shang-noodle-street", description: "Shang Noodle Street", amountCents: 10014, payerId: "monette", participantIds: coreSix },
  { id: "mr-chopstick", description: "Mr. Chopstick", amountCents: 25200, payerId: "monette", participantIds: allEight },
  { id: "giordano", description: "Giordano", amountCents: 12642, payerId: "eric", participantIds: coreSix },
  { id: "field-museum", description: "Field Museum", amountCents: 17400, payerId: "eric", participantIds: coreSix },
  { id: "airport-uber", description: "Uber to Chicago Airport", amountCents: 10900, payerId: "eric", participantIds: coreSix },
];

const cloneParticipants = (participants: Participant[]) => participants.map((participant) => ({ ...participant }));

const cloneExpenses = (expenses: Expense[]) =>
  expenses.map((expense) => ({
    ...expense,
    participantIds: [...expense.participantIds],
  }));

const demoBill: BillState = {
  activeEventId: "chicago-trip",
  events: [
    {
      id: "chicago-trip",
      name: "Chicago Trip",
      participants: cloneParticipants(demoParticipants),
      expenses: cloneExpenses(demoExpenses),
    },
  ],
};

const createBlankBill = (): BillState => ({
  activeEventId: "blank-event",
  events: [
    {
      id: "blank-event",
      name: "",
      participants: [],
      expenses: [],
    },
  ],
});

const getParticipantName = (participants: Participant[], id: string) =>
  participants.find((participant) => participant.id === id)?.name ?? "Unknown";

const formatMoney = (amountCents: number) => {
  const sign = amountCents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(amountCents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const amountInputValue = (amountCents: number) => (amountCents / 100).toFixed(2);

const parseAmountCents = (value: string) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.round(parsed * 100);
};

const createId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const getActiveEvent = (bill: BillState) =>
  bill.events.find((event) => event.id === bill.activeEventId) ?? bill.events[0] ?? createBlankBill().events[0];

const sanitizeEvent = (event: Partial<SplitEvent>, fallbackName: string): SplitEvent | null => {
  if (!Array.isArray(event.participants)) {
    return null;
  }

  const participants = event.participants
    .filter((participant) => typeof participant.id === "string" && typeof participant.name === "string")
    .map((participant) => ({
      id: participant.id,
      name: participant.name.trim() || "Unnamed",
    }));

  const participantIds = new Set(participants.map((participant) => participant.id));
  const firstParticipantId = participants[0]?.id;
  const expenses = Array.isArray(event.expenses)
    ? event.expenses
        .filter(
          (expense) =>
            typeof expense.id === "string" &&
            typeof expense.description === "string" &&
            typeof expense.amountCents === "number",
        )
        .map((expense) => {
          const selectedIds = Array.isArray(expense.participantIds)
            ? expense.participantIds.filter((id) => participantIds.has(id))
            : [];

          return {
            id: expense.id,
            description: expense.description,
            amountCents: Math.max(0, Math.round(expense.amountCents)),
            payerId: participantIds.has(expense.payerId ?? "") ? expense.payerId : firstParticipantId ?? "",
            participantIds: selectedIds.length > 0 ? selectedIds : firstParticipantId ? [firstParticipantId] : [],
          };
        })
        .filter((expense) => expense.payerId && expense.participantIds.length > 0)
    : [];

  return {
    id: typeof event.id === "string" ? event.id : createId("event"),
    name: typeof event.name === "string" && event.name.trim() ? event.name.trim() : fallbackName,
    participants,
    expenses,
  };
};

const normalizeBill = (bill: Partial<BillState>): BillState | null => {
  if (!Array.isArray(bill.events) || bill.events.length === 0) {
    return null;
  }

  const events = bill.events
    .map((event, index) => sanitizeEvent(event, index === 0 ? "Trip" : `Event ${index + 1}`))
    .filter((event): event is SplitEvent => Boolean(event));

  if (events.length === 0) {
    return null;
  }

  const activeEventId =
    typeof bill.activeEventId === "string" && events.some((event) => event.id === bill.activeEventId)
      ? bill.activeEventId
      : events[0].id;

  return { events, activeEventId };
};

const calculateBalances = ({ expenses, participants }: SplitEvent) => {
  const balances = new Map<string, number>();

  participants.forEach((participant) => balances.set(participant.id, 0));

  expenses.forEach((expense) => {
    const selectedIds = participants
      .map((participant) => participant.id)
      .filter((id) => expense.participantIds.includes(id));

    if (expense.amountCents <= 0 || selectedIds.length === 0 || !balances.has(expense.payerId)) {
      return;
    }

    balances.set(expense.payerId, (balances.get(expense.payerId) ?? 0) + expense.amountCents);

    const baseShare = Math.floor(expense.amountCents / selectedIds.length);
    const remainder = expense.amountCents % selectedIds.length;

    selectedIds.forEach((participantId, index) => {
      const share = baseShare + (index < remainder ? 1 : 0);
      balances.set(participantId, (balances.get(participantId) ?? 0) - share);
    });
  });

  return participants.map((participant) => ({
    participant,
    balanceCents: balances.get(participant.id) ?? 0,
  }));
};

const calculateSettlement = (event: SplitEvent): SettlementTransfer[] => {
  const balances = calculateBalances(event);
  const debtors = balances
    .filter(({ balanceCents }) => balanceCents < 0)
    .map(({ participant, balanceCents }) => ({ id: participant.id, amountCents: Math.abs(balanceCents) }));
  const creditors = balances
    .filter(({ balanceCents }) => balanceCents > 0)
    .map(({ participant, balanceCents }) => ({ id: participant.id, amountCents: balanceCents }));
  const transfers: SettlementTransfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountCents = Math.min(debtor.amountCents, creditor.amountCents);

    if (amountCents > 0) {
      transfers.push({
        fromId: debtor.id,
        toId: creditor.id,
        amountCents,
      });
    }

    debtor.amountCents -= amountCents;
    creditor.amountCents -= amountCents;

    if (debtor.amountCents === 0) {
      debtorIndex += 1;
    }

    if (creditor.amountCents === 0) {
      creditorIndex += 1;
    }
  }

  return transfers;
};

const encodeBillState = (bill: BillState) => {
  const json = JSON.stringify({ v: 2, events: bill.events, activeEventId: bill.activeEventId });
  const bytes = new TextEncoder().encode(json);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const decodeBillState = (encoded: string): BillState | null => {
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Partial<BillState> & LegacyBillState;

    if (payload.v === 2) {
      return normalizeBill(payload);
    }

    if (Array.isArray(payload.participants) && Array.isArray(payload.expenses)) {
      return normalizeBill({
        activeEventId: "chicago-trip",
        events: [
          {
            id: "chicago-trip",
            name: "Chicago Trip",
            participants: payload.participants,
            expenses: payload.expenses,
          },
        ],
      });
    }

    return null;
  } catch {
    return null;
  }
};

const readBillFromHash = () => {
  if (typeof window === "undefined") {
    return null;
  }

  const query = window.location.hash.split("?")[1];

  if (!query) {
    return null;
  }

  const data = new URLSearchParams(query).get("data");
  return data ? decodeBillState(data) : null;
};

export function SettleUpPage({ onBackToWork }: SettleUpPageProps) {
  const [bill, setBill] = useState<BillState>(() => readBillFromHash() ?? createBlankBill());
  const [newParticipantName, setNewParticipantName] = useState("");
  const [newEventName, setNewEventName] = useState("");
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    const syncBillFromHash = () => {
      const hashBill = readBillFromHash();

      if (hashBill) {
        setBill(hashBill);
      }
    };

    window.addEventListener("hashchange", syncBillFromHash);
    return () => window.removeEventListener("hashchange", syncBillFromHash);
  }, []);

  const activeEvent = useMemo(() => getActiveEvent(bill), [bill]);
  const balances = useMemo(() => calculateBalances(activeEvent), [activeEvent]);
  const settlement = useMemo(() => calculateSettlement(activeEvent), [activeEvent]);
  const totalCents = useMemo(
    () => activeEvent.expenses.reduce((sum, expense) => sum + expense.amountCents, 0),
    [activeEvent.expenses],
  );

  const updateActiveEvent = (updater: (event: SplitEvent) => SplitEvent) => {
    setShareStatus("idle");
    setBill((current) => ({
      ...current,
      events: current.events.map((event) => (event.id === current.activeEventId ? updater(event) : event)),
    }));
  };

  const switchEvent = (eventId: string) => {
    setShareStatus("idle");
    setBill((current) => ({ ...current, activeEventId: eventId }));
  };

  const renameActiveEvent = (name: string) => {
    updateActiveEvent((event) => ({
      ...event,
      name,
    }));
  };

  const addEvent = () => {
    const trimmedName = newEventName.trim();

    if (!trimmedName) {
      return;
    }

    const newEvent: SplitEvent = {
      id: createId("event"),
      name: trimmedName,
      participants: cloneParticipants(activeEvent.participants),
      expenses: [],
    };

    setShareStatus("idle");
    setBill((current) => ({
      events: [...current.events, newEvent],
      activeEventId: newEvent.id,
    }));
    setNewEventName("");
  };

  const updateExpense = (expenseId: string, patch: Partial<Expense>) => {
    updateActiveEvent((event) => ({
      ...event,
      expenses: event.expenses.map((expense) => (expense.id === expenseId ? { ...expense, ...patch } : expense)),
    }));
  };

  const toggleParticipant = (expense: Expense, participantId: string) => {
    const hasParticipant = expense.participantIds.includes(participantId);

    if (hasParticipant && expense.participantIds.length === 1) {
      return;
    }

    updateExpense(expense.id, {
      participantIds: hasParticipant
        ? expense.participantIds.filter((id) => id !== participantId)
        : [...expense.participantIds, participantId],
    });
  };

  const addExpense = () => {
    const firstParticipantId = activeEvent.participants[0]?.id;

    if (!firstParticipantId) {
      return;
    }

    updateActiveEvent((event) => ({
      ...event,
      expenses: [
        ...event.expenses,
        {
          id: createId("expense"),
          description: "New expense",
          amountCents: 0,
          payerId: firstParticipantId,
          participantIds: event.participants.map((participant) => participant.id),
        },
      ],
    }));
  };

  const removeExpense = (expenseId: string) => {
    updateActiveEvent((event) => ({
      ...event,
      expenses: event.expenses.filter((expense) => expense.id !== expenseId),
    }));
  };

  const addParticipant = () => {
    const trimmedName = newParticipantName.trim();

    if (!trimmedName) {
      return;
    }

    const participant: Participant = {
      id: createId("person"),
      name: trimmedName,
    };

    updateActiveEvent((event) => ({
      ...event,
      participants: [...event.participants, participant],
      expenses: event.expenses.map((expense) => ({
        ...expense,
        participantIds: [...expense.participantIds, participant.id],
      })),
    }));
    setNewParticipantName("");
  };

  const renameParticipant = (participantId: string, name: string) => {
    updateActiveEvent((event) => ({
      ...event,
      participants: event.participants.map((participant) =>
        participant.id === participantId ? { ...participant, name } : participant,
      ),
    }));
  };

  const removeParticipant = (participantId: string) => {
    updateActiveEvent((event) => {
      const participants = event.participants.filter((participant) => participant.id !== participantId);
      const fallbackParticipantId = participants[0]?.id;

      return {
        ...event,
        participants,
        expenses: fallbackParticipantId
          ? event.expenses.map((expense) => {
              const participantIds = expense.participantIds.filter((id) => id !== participantId);

              return {
                ...expense,
                payerId: expense.payerId === participantId ? fallbackParticipantId : expense.payerId,
                participantIds: participantIds.length > 0 ? participantIds : [fallbackParticipantId],
              };
            })
          : [],
      };
    });
  };

  const resetDemo = () => {
    setShareStatus("idle");
    setBill(demoBill);

    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/work/settle-up`);
    }
  };

  const copyShareUrl = async () => {
    if (typeof window === "undefined") {
      return;
    }

    const encoded = encodeBillState(bill);
    const shareUrl = `${window.location.origin}${window.location.pathname}${window.location.search}#/work/settle-up?data=${encoded}`;
    window.history.replaceState(null, "", shareUrl);

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus("copied");
    } catch {
      setShareStatus("failed");
    }
  };

  return (
    <section className="h-full w-full overflow-y-auto px-4 pb-8 pt-6 text-white sm:px-8 lg:px-12">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <button
              onClick={onBackToWork}
              className="mb-5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-white/50 transition-colors hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Work gallery
            </button>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-300/25 bg-emerald-300/10 text-emerald-100">
                <ReceiptText className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-4xl font-black tracking-tight md:text-5xl">Settle Up</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
                  Split each trip, dinner, and shared bill as its own event.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:flex">
            <button
              onClick={copyShareUrl}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-50 transition-colors hover:bg-emerald-300/20"
            >
              {shareStatus === "copied" ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
              {shareStatus === "copied" ? "Copied" : "Share"}
            </button>
              <button
                onClick={resetDemo}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-white/60 transition-colors hover:bg-white/10"
              >
                <RotateCcw className="h-4 w-4" />
                Demo data
              </button>
          </div>
        </header>

        {shareStatus === "failed" && (
          <div className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            Share URL was created in the address bar, but clipboard access was blocked.
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div className="order-2 flex min-w-0 flex-col gap-5 xl:order-1">
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0 flex-1">
                  <label className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Current event</label>
                  <input
                    value={activeEvent.name}
                    onChange={(event) => renameActiveEvent(event.target.value)}
                    placeholder="Name this split"
                    className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none transition-colors placeholder:text-white/30 focus:border-emerald-200/50"
                    aria-label="Current event name"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <label className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Add event</label>
                  <div className="mt-3 flex gap-2">
                    <input
                      value={newEventName}
                      onChange={(event) => setNewEventName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          addEvent();
                        }
                      }}
                      placeholder="Kyla's trip"
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-emerald-200/50"
                    />
                    <button
                      onClick={addEvent}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black text-black transition-transform hover:scale-[1.02]"
                    >
                      <Plus className="h-4 w-4" />
                      Add
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {bill.events.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => switchEvent(event.id)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold transition-colors",
                      event.id === activeEvent.id
                        ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-50"
                        : "border-white/10 bg-black/20 text-white/45 hover:text-white/75",
                    )}
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    {event.name || "Untitled event"}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4 lg:grid-cols-[18rem_1fr] lg:items-start">
              <div>
                <label className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Add person</label>
                <div className="mt-3 flex gap-2">
                  <input
                    value={newParticipantName}
                    onChange={(event) => setNewParticipantName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        addParticipant();
                      }
                    }}
                    placeholder="Friend name"
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-emerald-200/50"
                  />
                  <button
                    onClick={addParticipant}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black text-black transition-transform hover:scale-[1.02]"
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">People in this event</p>
                {activeEvent.participants.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-dashed border-white/15 bg-black/15 p-4 text-sm leading-6 text-white/45">
                    Add people first, then start entering expenses.
                  </div>
                ) : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {activeEvent.participants.map((participant) => (
                      <div key={participant.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2">
                        <input
                          value={participant.name}
                          onChange={(event) => renameParticipant(participant.id, event.target.value)}
                          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-bold text-white/75 outline-none transition-colors focus:border-emerald-200/40 focus:bg-black/25"
                          aria-label={`Rename ${participant.name || "Unnamed"}`}
                        />
                        <button
                          onClick={() => removeParticipant(participant.id)}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-white/40 transition-colors hover:border-rose-300/30 hover:bg-rose-300/10 hover:text-rose-100"
                          aria-label={`Remove ${participant.name || "Unnamed"}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/40">Expenses</p>
                <p className="mt-1 text-sm text-white/50">
                  {activeEvent.expenses.length} items - {formatMoney(totalCents)} total
                </p>
              </div>
              <button
                onClick={addExpense}
                disabled={activeEvent.participants.length === 0}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-black transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/35 disabled:hover:scale-100"
              >
                <Plus className="h-4 w-4" />
                Expense
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {activeEvent.expenses.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/15 bg-black/15 p-6 text-sm leading-6 text-white/50">
                  No expenses in this event yet. Add the first receipt, then choose who paid and who joined the split.
                </div>
              ) : (
                activeEvent.expenses.map((expense) => (
                  <ExpenseEditor
                    key={expense.id}
                    expense={expense}
                    participants={activeEvent.participants}
                    onChange={updateExpense}
                    onToggleParticipant={toggleParticipant}
                    onRemove={removeExpense}
                  />
                ))
              )}
            </div>
          </div>

          <aside className="order-1 xl:order-2 xl:sticky xl:top-24 xl:self-start">
            <div className="rounded-2xl border border-white/10 bg-[#101214]/90 p-5 shadow-2xl backdrop-blur-md">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100/60">Settlement</p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight">Who pays who</h2>
                  <p className="mt-1 text-xs font-semibold text-white/35">{activeEvent.name || "Untitled event"}</p>
                </div>
                <Copy className="h-5 w-5 text-white/40" />
              </div>

              {settlement.length === 0 ? (
                <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm leading-6 text-emerald-50/75">
                  No transfers needed. The group is already balanced.
                </div>
              ) : (
                <ol className="flex flex-col gap-3">
                  {settlement.map((transfer, index) => (
                    <li key={`${transfer.fromId}-${transfer.toId}-${index}`} className="rounded-xl border border-white/10 bg-white/[0.045] p-4">
                      <div className="flex items-center justify-between gap-4">
                        <p className="min-w-0 text-sm leading-6 text-white/70">
                          <span className="font-bold text-white">{getParticipantName(activeEvent.participants, transfer.fromId)}</span>
                          <span className="text-white/40"> pays </span>
                          <span className="font-bold text-white">{getParticipantName(activeEvent.participants, transfer.toId)}</span>
                        </p>
                        <span className="shrink-0 text-base font-black text-emerald-100">{formatMoney(transfer.amountCents)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              <div className="mt-6 border-t border-white/10 pt-5">
                <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-white/40">
                  <Users className="h-4 w-4" />
                  Net balance
                </div>
                <div className="flex flex-col gap-2">
                  {balances.map(({ participant, balanceCents }) => (
                    <div key={participant.id} className="flex items-center justify-between gap-3 rounded-xl bg-black/20 px-3 py-2">
                      <span className="min-w-0 truncate text-sm font-semibold text-white/70">{participant.name || "Unnamed"}</span>
                      <span
                        className={cn(
                          "shrink-0 text-sm font-black",
                          balanceCents > 0 && "text-emerald-300",
                          balanceCents < 0 && "text-rose-300",
                          balanceCents === 0 && "text-white/40",
                        )}
                      >
                        {formatMoney(balanceCents)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

interface ExpenseEditorProps {
  expense: Expense;
  participants: Participant[];
  onChange: (expenseId: string, patch: Partial<Expense>) => void;
  onToggleParticipant: (expense: Expense, participantId: string) => void;
  onRemove: (expenseId: string) => void;
}

const ExpenseEditor = ({ expense, participants, onChange, onToggleParticipant, onRemove }: ExpenseEditorProps) => {
  return (
    <article className="rounded-2xl border border-white/10 bg-[#101214]/90 p-4 shadow-xl backdrop-blur-md">
      <div className="grid gap-3 lg:grid-cols-[minmax(12rem,1.4fr)_8rem_10rem_auto] lg:items-center">
        <input
          value={expense.description}
          onChange={(event) => onChange(expense.id, { description: event.target.value })}
          className="min-w-0 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold text-white outline-none transition-colors placeholder:text-white/30 focus:border-emerald-200/50"
        />
        <input
          type="number"
          min="0"
          step="0.01"
          value={amountInputValue(expense.amountCents)}
          onChange={(event) => onChange(expense.id, { amountCents: parseAmountCents(event.target.value) })}
          className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none transition-colors focus:border-emerald-200/50"
          aria-label={`${expense.description} amount`}
        />
        <select
          value={expense.payerId}
          onChange={(event) => onChange(expense.id, { payerId: event.target.value })}
          className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none transition-colors focus:border-emerald-200/50"
          aria-label={`${expense.description} payer`}
        >
          {participants.map((participant) => (
            <option key={participant.id} value={participant.id} className="bg-[#101214] text-white">
              {participant.name || "Unnamed"}
            </option>
          ))}
        </select>
        <button
          onClick={() => onRemove(expense.id)}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 text-white/40 transition-colors hover:border-rose-300/30 hover:bg-rose-300/10 hover:text-rose-100"
          aria-label={`Remove ${expense.description}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {participants.map((participant) => {
          const selected = expense.participantIds.includes(participant.id);

          return (
            <button
              key={participant.id}
              onClick={() => onToggleParticipant(expense, participant.id)}
              className={cn(
                "rounded-full border px-3 py-2 text-xs font-bold transition-colors",
                selected
                  ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-50"
                  : "border-white/10 bg-black/20 text-white/40 hover:text-white/70",
              )}
            >
              {participant.name || "Unnamed"}
            </button>
          );
        })}
      </div>
    </article>
  );
};
