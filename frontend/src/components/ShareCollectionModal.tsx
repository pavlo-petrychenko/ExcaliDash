import React, { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  X,
  Plus,
  AlertTriangle,
  Check,
  RefreshCw,
  Search,
  ChevronDown,
  Users,
} from "lucide-react";
import * as api from "../api";
import type {
  CollectionShareRow,
  CollectionShareRole,
  CollectionShareUser,
} from "../types";
import { useAuth } from "../context/AuthContext";

type Props = {
  collectionId: string;
  collectionName: string;
  isOpen: boolean;
  onClose: () => void;
};

const ROLE_OPTIONS: {
  label: string;
  value: CollectionShareRole;
  danger?: boolean;
}[] = [
  { label: "Viewer", value: "view" },
  { label: "Editor", value: "edit" },
];

const RoleSelect: React.FC<{
  value: CollectionShareRole;
  onChange: (val: string) => void;
  extraOptions?: { label: string; value: string; danger?: boolean }[];
}> = ({ value, onChange, extraOptions = [] }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const options = [...ROLE_OPTIONS, ...extraOptions];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-bold text-slate-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-all outline-none"
      >
        {current.label}
        <ChevronDown
          size={14}
          className={clsx(
            "transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 min-w-[150px] bg-white dark:bg-neutral-900 border-2 border-black dark:border-neutral-700 rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] overflow-hidden z-[200] animate-in fade-in zoom-in-95 duration-100">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(opt.value);
                setOpen(false);
              }}
              className={clsx(
                "w-full text-left px-4 py-2.5 text-sm font-bold transition-colors flex items-center justify-between border-b last:border-b-0 border-slate-100 dark:border-neutral-800",
                opt.value === value
                  ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400"
                  : opt.danger
                    ? "text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                    : "text-slate-700 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-800",
              )}
            >
              {opt.label}
              {opt.value === value && !opt.danger && (
                <Check size={14} strokeWidth={3} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const ShareCollectionModal: React.FC<Props> = ({
  collectionId,
  collectionName,
  isOpen,
  onClose,
}) => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shares, setShares] = useState<CollectionShareRow[]>([]);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CollectionShareUser[]>([]);
  const [addRole, setAddRole] = useState<CollectionShareRole>("view");

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getCollectionShares(collectionId);
      setShares(data.shares);
    } catch (err: unknown) {
      let msg = "Failed to load sharing settings";
      if (api.isAxiosError(err)) {
        const s = err.response?.data?.message;
        if (typeof s === "string") msg = s;
      }
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [collectionId]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setResults([]);
    setAddRole("view");
    setError(null);
    void refresh();
  }, [isOpen, refresh]);

  // Debounced user search
  useEffect(() => {
    if (!isOpen) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const users = await api.resolveCollectionShareUsers(collectionId, q);
        if (!cancelled) setResults(users);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, collectionId, isOpen]);

  const handleAdd = async (u: CollectionShareUser) => {
    setIsLoading(true);
    setError(null);
    try {
      await api.addCollectionShare(collectionId, u.email, addRole);
      await refresh();
      setQuery("");
      setResults([]);
    } catch (err: unknown) {
      let msg = "Failed to share with user";
      if (api.isAxiosError(err)) {
        const s = err.response?.data?.message ?? err.response?.data?.error;
        if (typeof s === "string") msg = s;
      }
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, val: string) => {
    if (val === "remove") {
      await handleRemove(userId);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await api.updateCollectionShare(
        collectionId,
        userId,
        val as CollectionShareRole,
      );
      await refresh();
    } catch {
      setError("Failed to update role");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await api.removeCollectionShare(collectionId, userId);
      await refresh();
    } catch {
      setError("Failed to remove user");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-[540px] bg-white dark:bg-neutral-900 rounded-[24px] border-2 border-black dark:border-neutral-700 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] dark:shadow-[12px_12px_0px_0px_rgba(255,255,255,0.05)] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-8 py-6 flex items-center justify-between border-b-2 border-black dark:border-neutral-700">
          <h2
            className="text-xl font-black text-slate-800 dark:text-neutral-100 truncate pr-4"
            title={collectionName}
          >
            Share "{collectionName}"
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-xl border-2 border-transparent hover:border-black dark:hover:border-neutral-600 transition-all group shrink-0"
          >
            <X
              size={20}
              strokeWidth={3}
              className="group-hover:rotate-90 transition-transform duration-200"
            />
          </button>
        </div>

        <div className="flex-1 px-8 pt-8 pb-10 space-y-8 overflow-visible">
          {/* Error */}
          {error && (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-900/20 border-2 border-rose-600 dark:border-rose-500 text-sm font-bold text-rose-600 dark:text-rose-400 flex items-center gap-3">
              <AlertTriangle size={18} strokeWidth={3} />
              {error}
            </div>
          )}

          {/* Search + role selector */}
          <section className="relative">
            <div className="flex gap-2 items-center">
              <div className="relative flex-1 group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors">
                  <Search size={20} strokeWidth={2.5} />
                </div>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Add people by name or email"
                  className="w-full pl-12 pr-4 py-4 rounded-xl border-2 border-black dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800 text-slate-900 dark:text-neutral-100 focus:outline-none focus:border-indigo-600 dark:focus:border-indigo-500 transition-all font-bold placeholder:text-slate-400 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.05)]"
                />
              </div>
              {/* Role picker for new additions */}
              <div className="shrink-0 border-2 border-black dark:border-neutral-700 rounded-xl px-1 bg-white dark:bg-neutral-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.05)]">
                <RoleSelect
                  value={addRole}
                  onChange={(v) => setAddRole(v as CollectionShareRole)}
                />
              </div>
            </div>

            {results.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-3 border-2 border-black dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-900 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,0.1)] overflow-hidden z-[200] animate-in fade-in slide-in-from-top-2">
                {results.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleAdd(u)}
                    className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors group border-b last:border-b-0 border-slate-100 dark:border-neutral-800"
                  >
                    <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-black text-lg border-2 border-black dark:border-neutral-600">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-black text-slate-900 dark:text-neutral-100 truncate">
                        {u.name}
                      </div>
                      <div className="text-xs font-bold text-slate-500 dark:text-neutral-400 truncate">
                        {u.email}
                      </div>
                    </div>
                    <Plus
                      size={20}
                      className="text-slate-400 group-hover:text-indigo-600 transition-colors"
                      strokeWidth={3}
                    />
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* People with access */}
          <section className="space-y-4">
            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-neutral-500 px-1">
              People with access
            </h3>

            <div className="space-y-1">
              {/* Owner row (always current user) */}
              <div className="flex items-center gap-4 px-1 py-3 min-h-[64px]">
                <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-neutral-800 flex items-center justify-center text-slate-600 dark:text-neutral-300 font-black text-xl border-2 border-black dark:border-neutral-600 shrink-0">
                  {user?.name?.charAt(0).toUpperCase() ?? "U"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-base font-black text-slate-900 dark:text-neutral-100 leading-tight">
                    {user?.name}{" "}
                    <span className="text-slate-400 dark:text-neutral-500 font-bold ml-1">
                      (you)
                    </span>
                  </div>
                  <div className="text-sm font-bold text-slate-500 dark:text-neutral-400 mt-0.5">
                    {user?.email}
                  </div>
                </div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-neutral-500 pr-4 shrink-0">
                  Owner
                </div>
              </div>

              {shares.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-8 text-slate-400 dark:text-neutral-500">
                  <Users size={32} strokeWidth={1.5} />
                  <p className="text-sm font-bold">
                    No one else has access yet
                  </p>
                </div>
              )}

              {shares.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-4 px-1 py-3 min-h-[64px] group"
                >
                  <div className="w-11 h-11 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-black text-xl border-2 border-indigo-600 dark:border-indigo-500 shrink-0">
                    {s.granteeUser.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-black text-slate-900 dark:text-neutral-100 leading-tight truncate">
                      {s.granteeUser.name}
                    </div>
                    <div className="text-sm font-bold text-slate-500 dark:text-neutral-400 mt-0.5 truncate">
                      {s.granteeUser.email}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <RoleSelect
                      value={s.role}
                      onChange={(val) => handleRoleChange(s.granteeUserId, val)}
                      extraOptions={[
                        {
                          label: "Remove access",
                          value: "remove",
                          danger: true,
                        },
                      ]}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-8 py-6 flex items-center justify-end border-t-2 border-black dark:border-neutral-700 bg-slate-50 dark:bg-neutral-800/50 rounded-b-[22px]">
          <button
            onClick={onClose}
            className="px-12 py-3.5 rounded-xl bg-indigo-600 dark:bg-indigo-500 text-white border-2 border-black font-black text-sm uppercase tracking-[0.2em] hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-y-0 active:shadow-none transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
          >
            DONE
          </button>
        </div>

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-white/20 dark:bg-black/10 backdrop-blur-[1px] flex items-center justify-center z-[300] pointer-events-none rounded-[24px]">
            <div className="bg-white dark:bg-neutral-900 border-2 border-black dark:border-neutral-700 p-5 rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
              <RefreshCw
                size={28}
                strokeWidth={3}
                className="animate-spin text-indigo-600 dark:text-indigo-400"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
