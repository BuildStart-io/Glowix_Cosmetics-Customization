import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  FileSpreadsheet,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Trash2,
  Truck,
  Sparkles,
} from "lucide-react";

interface Order {
  id: string;
  customer_name: string;
  customer_phone: string;
  secondary_phone?: string | null;
  whatsapp_phone?: string | null;
  waybill_number?: string | null;
  district?: string | null;
  status: string;
  total_amount: number;
}

interface WaybillImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  existingOrders: Order[];
}

interface MatchResult {
  order: Order;
  newWaybill: string;
  isOverwrite: boolean;
  matchType: "both_phones" | "phone_1" | "phone_2" | "whatsapp_phone" | "order_id" | "name_cod";
  matchedNumber: string;
  matchedScore: number;
  rowNumber: number;
}

interface UnmatchedRow {
  rowNumber: number;
  identifier: string;
  customerName?: string;
  waybill: string;
  cod?: string;
}

/**
 * Extract all phone numbers from a cell string that may contain multiple
 * numbers separated by slashes, commas, newlines, semicolons, etc.
 * e.g. "778428103/750237916" -> ["778428103", "750237916"]
 * e.g. "0772057539/" -> ["0772057539"]
 */
function extractPhoneTokens(raw: any): string[] {
  if (raw === null || raw === undefined) return [];
  const str = String(raw).trim();
  if (!str) return [];

  // Split by common separators: / , ; \n | &
  const parts = str.split(/[/,;\n|&]+/).map((p) => p.trim()).filter(Boolean);
  const tokens: string[] = [];

  for (const part of parts) {
    const digits = part.replace(/\D/g, "");
    if (digits.length >= 6) {
      tokens.push(digits);
    }
  }

  // If no separator was found but digits is long (like raw phone)
  if (tokens.length === 0) {
    const digits = str.replace(/\D/g, "");
    if (digits.length >= 6) tokens.push(digits);
  }

  return tokens;
}

/**
 * Generate normalized lookup keys for Sri Lankan phone numbers:
 * 9-digit: 778428103
 * 10-digit: 0778428103
 * 11-digit: 94778428103
 * plus last 7 digits for landlines/typos
 */
function getPhoneVariants(digits: string): string[] {
  if (!digits) return [];
  const set = new Set<string>();
  set.add(digits);

  if (digits.startsWith("94") && digits.length >= 11) {
    const local = digits.slice(2);
    set.add(local);
    set.add("0" + local);
  } else if (digits.startsWith("0") && digits.length === 10) {
    const local = digits.slice(1);
    set.add(local);
    set.add("94" + local);
  } else if (digits.length === 9) {
    set.add("0" + digits);
    set.add("94" + digits);
  }

  if (digits.length >= 7) {
    set.add(digits.slice(-7));
  }

  return Array.from(set);
}

export default function WaybillImportModal({
  isOpen,
  onClose,
  onSuccess,
  existingOrders,
}: WaybillImportModalProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<any[]>([]);

  // Column Mappings
  const [phoneColumn, setPhoneColumn] = useState<string>("");
  const [waybillColumn, setWaybillColumn] = useState<string>("");

  // Matching Results & Settings
  const [matched, setMatched] = useState<MatchResult[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [overwriteExisting, setOverwriteExisting] = useState<boolean>(true);
  const [markAsShipped, setMarkAsShipped] = useState<boolean>(true);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [viewTab, setViewTab] = useState<"matched" | "unmatched">("matched");

  // Read and parse uploaded file
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploaded = e.target.files?.[0];
    if (!uploaded) return;

    setFile(uploaded);
    setIsProcessing(true);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result;
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        if (rawJson.length === 0) {
          toast({
            title: "Empty file",
            description: "The uploaded sheet contains no data.",
            variant: "destructive",
          });
          setIsProcessing(false);
          return;
        }

        const headers = Object.keys(rawJson[0]);
        setColumns(headers);
        setParsedRows(rawJson);

        // Smart auto-detect WAYBILL Column (Image 2: WAYBILL ID)
        const autoWaybill =
          headers.find((h) => /^waybill(\s*(id|no|number))?$/i.test(h.trim())) ||
          headers.find((h) =>
            /waybill|way_bill|way bill|tracking|awb|consignment|barcode|tracking_no/i.test(h)
          ) ||
          (headers.length > 1 ? headers[1] : headers[0]);

        // Smart auto-detect Phone / Order ID Column (Image 2: PHONE NUMBER)
        const autoPhone =
          headers.find((h) => /^phone(\s*number)?$/i.test(h.trim())) ||
          headers.find((h) => /^customer(\s*first)?\s*phone(\s*no)?$/i.test(h.trim())) ||
          headers.find((h) =>
            /phone|mobile|contact|tel|no-1|no-2|customer_phone|telephone/i.test(h)
          ) ||
          headers.find((h) => /^order\s*(number|id|no|#)?$/i.test(h.trim())) ||
          headers[0];

        setPhoneColumn(autoPhone || "");
        setWaybillColumn(autoWaybill || "");

        // Compute match immediately
        runMatching(rawJson, autoPhone || "", autoWaybill || "");
      } catch (err: any) {
        console.error("Excel parse error:", err);
        toast({
          title: "Failed to parse file",
          description: err.message,
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
      }
    };

    reader.readAsArrayBuffer(uploaded);
  };

  // High-accuracy Multi-strategy Matching Algorithm
  const runMatching = (rows: any[], targetPhoneCol: string, targetWaybillCol: string) => {
    if (!targetPhoneCol || !targetWaybillCol || rows.length === 0) return;

    // Detect optional auxiliary columns in uploaded file
    const headers = Object.keys(rows[0] || {});
    const codCol =
      headers.find((h) => /^cod(\s*amount)?$/i.test(h.trim())) ||
      headers.find((h) => /cod|collection|amount|total/i.test(h));
    const nameCol =
      headers.find((h) => /^customer(\s*name)?$/i.test(h.trim())) ||
      headers.find((h) => /customer|recipient|client\s*name|name/i.test(h));
    const orderIdCol = headers.find(
      (h) => /^order\s*(number|id|no|#)$/i.test(h.trim()) && !/date/i.test(h)
    );

    // Pre-calculate variants for all existing orders
    const preparedOrders = existingOrders.map((o) => {
      const p1Digits = (o.customer_phone || "").replace(/\D/g, "");
      const p2Digits = (o.secondary_phone || "").replace(/\D/g, "");
      const waDigits = (o.whatsapp_phone || "").replace(/\D/g, "");

      return {
        order: o,
        idLower: o.id.toLowerCase(),
        idPrefix: o.id.slice(0, 8).toLowerCase(),
        p1Variants: new Set(getPhoneVariants(p1Digits)),
        p2Variants: new Set(getPhoneVariants(p2Digits)),
        waVariants: new Set(getPhoneVariants(waDigits)),
        p1Last7: p1Digits.slice(-7),
        p2Last7: p2Digits.slice(-7),
        totalAmount: Number(o.total_amount) || 0,
        nameLower: (o.customer_name || "").toLowerCase().trim(),
      };
    });

    // Score all candidate matches between rows and orders
    interface Candidate {
      rowIndex: number;
      rowNumber: number;
      rawWaybill: string;
      rawIdVal: string;
      orderIndex: number;
      score: number;
      matchType: MatchResult["matchType"];
    }

    const allCandidates: Candidate[] = [];
    const validRows: { index: number; row: any; waybill: string; idVal: string }[] = [];

    rows.forEach((row, rowIndex) => {
      const rawIdVal = String(row[targetPhoneCol] || "").trim();
      const rawWaybill = String(row[targetWaybillCol] || "").trim();

      // Skip completely empty lines
      if (!rawIdVal && !rawWaybill) return;

      validRows.push({ index: rowIndex, row, waybill: rawWaybill, idVal: rawIdVal });

      if (!rawWaybill) return;

      // Extract phone tokens & variants from current row
      const rowTokens = extractPhoneTokens(rawIdVal);
      const rowPhoneVariants = new Set<string>();
      rowTokens.forEach((tok) => {
        getPhoneVariants(tok).forEach((v) => rowPhoneVariants.add(v));
      });

      // Check optional row fields
      const rowOrderId = orderIdCol ? String(row[orderIdCol] || "").trim().toLowerCase() : "";
      const rowName = nameCol ? String(row[nameCol] || "").trim().toLowerCase() : "";
      const rowCodRaw = codCol ? String(row[codCol] || "").replace(/[^0-9.]/g, "") : "";
      const rowCod = rowCodRaw ? parseFloat(rowCodRaw) : NaN;

      preparedOrders.forEach((po, orderIndex) => {
        let score = 0;
        let matchType: MatchResult["matchType"] = "phone_1";

        // 1. Direct Order ID / Number Match (Highest confidence)
        const idMatches =
          (rowOrderId && (rowOrderId === po.idLower || rowOrderId === po.idPrefix)) ||
          rawIdVal.toLowerCase() === po.idLower ||
          rawIdVal.toLowerCase() === po.idPrefix;

        if (idMatches) {
          score += 1000;
          matchType = "order_id";
        }

        // 2. Dual Phone Match: Row contains both Phone 1 and Phone 2 (e.g. "778428103/750237916")
        const hasP1 = Array.from(po.p1Variants).some((v) => rowPhoneVariants.has(v));
        const hasP2 = po.p2Variants.size > 0 && Array.from(po.p2Variants).some((v) => rowPhoneVariants.has(v));

        if (hasP1 && hasP2) {
          score += 500;
          matchType = "both_phones";
        } else if (hasP1) {
          score += 200;
          matchType = "phone_1";
        } else if (hasP2) {
          score += 180;
          matchType = "phone_2";
        } else if (po.waVariants.size > 0 && Array.from(po.waVariants).some((v) => rowPhoneVariants.has(v))) {
          score += 150;
          matchType = "whatsapp_phone";
        }

        // 3. Fallback: Last 7 digits match (handles formatting or leading 0 typos)
        if (score === 0 && rowTokens.length > 0) {
          const rowLast7List = rowTokens.map((t) => t.slice(-7)).filter((t) => t.length === 7);
          if (po.p1Last7.length === 7 && rowLast7List.includes(po.p1Last7)) {
            score += 110;
            matchType = "phone_1";
          } else if (po.p2Last7.length === 7 && rowLast7List.includes(po.p2Last7)) {
            score += 100;
            matchType = "phone_2";
          }
        }

        // 4. COD Amount Match Bonus
        if (!isNaN(rowCod) && po.totalAmount > 0) {
          const diff = Math.abs(rowCod - po.totalAmount);
          if (diff < 1.0) {
            score += 80;
          }
        }

        // 5. Customer Name Match Bonus
        if (rowName && po.nameLower) {
          if (rowName === po.nameLower || rowName.includes(po.nameLower) || po.nameLower.includes(rowName)) {
            score += 40;
          }
        }

        // 6. Name + COD Fallback match (when phone wasn't included)
        if (score === 0 && rowName && !isNaN(rowCod)) {
          const diff = Math.abs(rowCod - po.totalAmount);
          const nameMatches =
            rowName === po.nameLower ||
            (rowName.length >= 4 && po.nameLower.includes(rowName)) ||
            (po.nameLower.length >= 4 && rowName.includes(po.nameLower));

          if (nameMatches && diff < 1.0) {
            score += 120;
            matchType = "name_cod";
          }
        }

        if (score >= 100) {
          allCandidates.push({
            rowIndex,
            rowNumber: rowIndex + 2,
            rawWaybill,
            rawIdVal,
            orderIndex,
            score,
            matchType,
          });
        }
      });
    });

    // Greedy 1-to-1 Assignment: sort candidate pairs by score descending
    allCandidates.sort((a, b) => b.score - a.score);

    const assignedOrderIndices = new Set<number>();
    const assignedRowIndices = new Set<number>();
    const matchedList: MatchResult[] = [];

    for (const cand of allCandidates) {
      if (assignedOrderIndices.has(cand.orderIndex) || assignedRowIndices.has(cand.rowIndex)) {
        continue;
      }

      assignedOrderIndices.add(cand.orderIndex);
      assignedRowIndices.add(cand.rowIndex);

      const targetOrder = preparedOrders[cand.orderIndex].order;
      matchedList.push({
        order: targetOrder,
        newWaybill: cand.rawWaybill,
        isOverwrite: Boolean(targetOrder.waybill_number && targetOrder.waybill_number !== cand.rawWaybill),
        matchType: cand.matchType,
        matchedNumber: cand.rawIdVal,
        matchedScore: cand.score,
        rowNumber: cand.rowNumber,
      });
    }

    // Build unmatched rows list
    const unmatchedList: UnmatchedRow[] = [];
    validRows.forEach((item) => {
      if (!assignedRowIndices.has(item.index)) {
        const rowName = nameCol ? String(item.row[nameCol] || "").trim() : undefined;
        const rowCod = codCol ? String(item.row[codCol] || "").trim() : undefined;

        unmatchedList.push({
          rowNumber: item.index + 2,
          identifier: item.idVal || "(No Phone/ID)",
          customerName: rowName,
          waybill: item.waybill || "(No Waybill)",
          cod: rowCod,
        });
      }
    });

    setMatched(matchedList);
    setUnmatched(unmatchedList);
  };

  // Re-run matching when user manually selects columns
  const handleColumnChange = (newPhone: string, newWaybill: string) => {
    setPhoneColumn(newPhone);
    setWaybillColumn(newWaybill);
    runMatching(parsedRows, newPhone, newWaybill);
  };

  // Apply matched waybills to Database
  const handleApplyWaybills = async () => {
    if (matched.length === 0) return;

    setIsApplying(true);
    try {
      const toUpdate = overwriteExisting ? matched : matched.filter((m) => !m.isOverwrite);

      if (toUpdate.length === 0) {
        toast({
          title: "Nothing to update",
          description: "All matched orders already have waybills. Turn on 'Overwrite Existing' to replace them.",
        });
        setIsApplying(false);
        return;
      }

      const now = new Date().toISOString();
      const BATCH_SIZE = 20;

      for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
        const batch = toUpdate.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map((item) => {
            const updatePayload: Record<string, any> = {
              waybill_number: item.newWaybill,
              waybill_updated_at: now,
            };

            // If markAsShipped is enabled and order is currently pending/processing, transition to shipped
            if (
              markAsShipped &&
              (item.order.status === "pending" || item.order.status === "processing")
            ) {
              updatePayload.status = "shipped";
            }

            return supabase.from("orders").update(updatePayload).eq("id", item.order.id);
          })
        );
      }

      toast({
        title: "Waybills Imported Successfully! 🎉",
        description: `Updated ${toUpdate.length} orders with their courier WAY BILL numbers.${
          markAsShipped ? " Status updated to Shipped." : ""
        }`,
      });

      onSuccess();
      handleClose();
    } catch (err: any) {
      console.error("Apply waybills error:", err);
      toast({
        title: "Error applying waybills",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setColumns([]);
    setParsedRows([]);
    setMatched([]);
    setUnmatched([]);
    setPhoneColumn("");
    setWaybillColumn("");
    onClose();
  };

  const resetFile = () => {
    setFile(null);
    setColumns([]);
    setParsedRows([]);
    setMatched([]);
    setUnmatched([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const toApplyCount = overwriteExisting
    ? matched.length
    : matched.filter((m) => !m.isOverwrite).length;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            Import Courier Waybills (BarcodePrint / Excel / CSV)
          </DialogTitle>
          <DialogDescription className="text-xs">
            Auto-matches courier tracking numbers with existing orders using Dual Phones (No-1 / No-2 with slashes), Order ID, and COD amounts.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-5">
          {/* STEP 1: FILE UPLOAD */}
          {!file ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30 transition-all rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer text-center space-y-3"
            >
              <div className="h-12 w-12 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                <UploadCloud className="h-6 w-6" />
              </div>
              <div>
                <h4 className="font-semibold text-sm">Drop your Courier Excel or CSV file here</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Supports BarcodePrint, bulk dispatch sheets, and courier tracking files (.xlsx, .xls, .csv)
                </p>
              </div>
              <Button variant="outline" size="sm" type="button" className="text-xs">
                Browse Files
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
          ) : (
            <div className="space-y-4">
              {/* File Info Bar */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30 text-xs">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                  <span className="font-medium text-foreground">{file.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {parsedRows.length} rows loaded
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFile}
                  className="h-7 text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3 w-3 mr-1" /> Change File
                </Button>
              </div>

              {/* STEP 2: COLUMN MAPPING */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl border bg-card">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold flex items-center justify-between">
                    <span>1. Phone / Order ID Column:</span>
                    <span className="text-[10px] text-muted-foreground font-normal">
                      Auto-detected: <code>{phoneColumn || "None"}</code>
                    </span>
                  </Label>
                  <Select
                    value={phoneColumn}
                    onValueChange={(val) => handleColumnChange(val, waybillColumn)}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((c) => (
                        <SelectItem key={c} value={c} className="text-xs">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold flex items-center justify-between">
                    <span>2. WAY BILL Column:</span>
                    <span className="text-[10px] text-muted-foreground font-normal">
                      Auto-detected: <code>{waybillColumn || "None"}</code>
                    </span>
                  </Label>
                  <Select
                    value={waybillColumn}
                    onValueChange={(val) => handleColumnChange(phoneColumn, val)}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((c) => (
                        <SelectItem key={c} value={c} className="text-xs">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* STEP 3: MATCHING ANALYTICS & OPTIONS */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div
                  onClick={() => setViewTab("matched")}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    viewTab === "matched"
                      ? "border-emerald-500 bg-emerald-500/10 shadow-sm"
                      : "bg-muted/20"
                  }`}
                >
                  <span className="text-xs text-emerald-700 dark:text-emerald-400 block font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Matched Orders
                  </span>
                  <span className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
                    {matched.length}
                  </span>
                  <span className="text-[10px] text-muted-foreground block">
                    Click to view matched orders
                  </span>
                </div>

                <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground font-medium flex items-center gap-1">
                      <Truck className="h-3.5 w-3.5 text-blue-600" /> Mark as Shipped
                    </span>
                    <Switch
                      checked={markAsShipped}
                      onCheckedChange={setMarkAsShipped}
                      className="scale-75"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t">
                    <span className="text-xs text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" /> Overwrite Existing
                    </span>
                    <Switch
                      checked={overwriteExisting}
                      onCheckedChange={setOverwriteExisting}
                      className="scale-75"
                    />
                  </div>
                </div>

                <div
                  onClick={() => setViewTab("unmatched")}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    viewTab === "unmatched"
                      ? "border-rose-500 bg-rose-500/10 shadow-sm"
                      : "bg-muted/20"
                  }`}
                >
                  <span className="text-xs text-rose-600 dark:text-rose-400 block font-medium flex items-center gap-1">
                    <XCircle className="h-3.5 w-3.5" /> Unmatched Rows
                  </span>
                  <span className="text-xl font-bold text-rose-600 dark:text-rose-400">
                    {unmatched.length}
                  </span>
                  <span className="text-[10px] text-muted-foreground block">
                    Click to inspect unmatched data
                  </span>
                </div>
              </div>

              {/* STEP 4: PREVIEW TABLE */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    {viewTab === "matched"
                      ? `Matched Orders Preview (${matched.length})`
                      : `Unmatched Excel Rows (${unmatched.length})`}
                  </span>
                  <span className="text-[11px]">
                    Smart matching: Dual Phone (No-1 / No-2) • COD • Name • Order ID
                  </span>
                </div>

                <div className="border rounded-lg max-h-60 overflow-y-auto bg-card text-xs">
                  {viewTab === "matched" ? (
                    matched.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground">
                        No matching orders found. Please verify the selected columns above.
                      </div>
                    ) : (
                      <table className="w-full text-left">
                        <thead className="bg-muted/50 sticky top-0 border-b">
                          <tr className="text-muted-foreground">
                            <th className="p-2">Customer</th>
                            <th className="p-2">Excel Phone</th>
                            <th className="p-2">Match Key</th>
                            <th className="p-2">Order COD</th>
                            <th className="p-2">New WAY BILL</th>
                            <th className="p-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {matched.map((m, idx) => (
                            <tr key={idx} className="hover:bg-muted/30">
                              <td className="p-2 font-medium">
                                <div>{m.order.customer_name}</div>
                                <div className="text-[10px] text-muted-foreground font-mono">
                                  #{m.order.id.slice(0, 8)}
                                </div>
                              </td>
                              <td className="p-2 font-mono text-[11px]">{m.matchedNumber}</td>
                              <td className="p-2">
                                {m.matchType === "both_phones" && (
                                  <Badge className="bg-emerald-600 text-white text-[10px]">
                                    📱 Dual Phone (1 & 2)
                                  </Badge>
                                )}
                                {m.matchType === "phone_1" && (
                                  <Badge variant="outline" className="text-[10px]">
                                    📞 No-1 (Primary)
                                  </Badge>
                                )}
                                {m.matchType === "phone_2" && (
                                  <Badge variant="outline" className="text-[10px]">
                                    📱 No-2 (Alt)
                                  </Badge>
                                )}
                                {m.matchType === "whatsapp_phone" && (
                                  <Badge variant="outline" className="text-[10px]">
                                    💬 WhatsApp Phone
                                  </Badge>
                                )}
                                {m.matchType === "order_id" && (
                                  <Badge variant="secondary" className="text-[10px]">
                                    🔖 Order ID Match
                                  </Badge>
                                )}
                                {m.matchType === "name_cod" && (
                                  <Badge variant="outline" className="text-[10px]">
                                    👤 Name + COD Match
                                  </Badge>
                                )}
                              </td>
                              <td className="p-2 font-mono text-[11px]">
                                LKR {Number(m.order.total_amount).toLocaleString()}
                              </td>
                              <td className="p-2">
                                <Badge
                                  variant="default"
                                  className="font-mono text-[11px] bg-emerald-600"
                                >
                                  {m.newWaybill}
                                </Badge>
                              </td>
                              <td className="p-2 text-[11px] text-muted-foreground">
                                {m.isOverwrite ? (
                                  <span className="text-amber-600 font-mono">
                                    Was: {m.order.waybill_number}
                                  </span>
                                ) : (
                                  <span className="text-emerald-600">New Assignment</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  ) : unmatched.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      🎉 All rows from your Excel sheet matched existing orders!
                    </div>
                  ) : (
                    <table className="w-full text-left">
                      <thead className="bg-muted/50 sticky top-0 border-b">
                        <tr className="text-muted-foreground">
                          <th className="p-2">Row #</th>
                          <th className="p-2">Excel Phone / ID</th>
                          <th className="p-2">Customer</th>
                          <th className="p-2">COD</th>
                          <th className="p-2">Excel WAY BILL</th>
                          <th className="p-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {unmatched.map((u, idx) => (
                          <tr key={idx} className="hover:bg-muted/30">
                            <td className="p-2 text-muted-foreground font-mono">{u.rowNumber}</td>
                            <td className="p-2 font-mono font-medium">{u.identifier}</td>
                            <td className="p-2 text-muted-foreground">{u.customerName || "-"}</td>
                            <td className="p-2 font-mono">{u.cod || "-"}</td>
                            <td className="p-2 font-mono">{u.waybill}</td>
                            <td className="p-2 text-rose-500 text-[11px]">
                              Not found in current orders
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="pt-3 border-t flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {matched.length > 0 && (
              <span>
                Ready to update <strong>{toApplyCount}</strong> orders with waybills
                {markAsShipped ? " (and mark as Shipped)" : ""}.
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleClose} disabled={isApplying}>
              Cancel
            </Button>
            {file && (
              <Button
                variant="default"
                size="sm"
                onClick={handleApplyWaybills}
                disabled={toApplyCount === 0 || isApplying}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              >
                {isApplying ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Updating Orders...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Apply {toApplyCount} Waybills
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
