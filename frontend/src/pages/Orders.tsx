import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Eye, ShoppingCart, Loader2, Phone, MapPin, CreditCard, Package, MessageSquare, Trash2, Download, PieChart as PieChartIcon, AlertTriangle, Search, Copy, Check, FileSpreadsheet, MessageCircle, Send, CheckCircle2, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import LimitWarningBanner from "@/components/LimitWarningBanner";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { Input } from "@/components/ui/input";
import WaybillImportModal from "@/components/orders/WaybillImportModal";
import SendWaybillModal from "@/components/orders/SendWaybillModal";
import * as XLSX from "xlsx";

interface Order {
  id: string;
  customer_name: string;
  customer_phone: string;
  secondary_phone?: string | null;
  whatsapp_phone: string | null;
  district: string | null;
  customer_address: string | null;
  order_items: unknown;
  special_instructions: string | null;
  payment_method: string;
  status: string;
  total_amount: number;
  is_preorder: boolean;
  waybill_number?: string | null;
  waybill_updated_at?: string | null;
  waybill_sent_at?: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  processing: "bg-blue-100 text-blue-800",
  shipped: "bg-purple-100 text-purple-800",
  delivered: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

const statusOptions = [
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

const DISTRICT_COLORS = [
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#6366f1", // Indigo
  "#14b8a6", // Teal
  "#64748b", // Slate
];

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [orderTypeFilter, setOrderTypeFilter] = useState<"all" | "standard" | "preorder">("all");
  const [showDistrictAnalytics, setShowDistrictAnalytics] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState("");
  const [isWaybillModalOpen, setIsWaybillModalOpen] = useState(false);
  const [copiedWaybill, setCopiedWaybill] = useState<string | null>(null);
  const [isSendWaybillModalOpen, setIsSendWaybillModalOpen] = useState(false);
  const [selectedWaybillOrderId, setSelectedWaybillOrderId] = useState<string | null>(null);

  const pendingWaybillCount = useMemo(() => {
    return orders.filter(
      (o) => Boolean(o.waybill_number && o.waybill_number.trim() && !o.waybill_sent_at)
    ).length;
  }, [orders]);

  const handleOpenSendWaybill = (orderId?: string | null) => {
    setSelectedWaybillOrderId(orderId || null);
    setIsSendWaybillModalOpen(true);
  };

  const handleCopyWaybill = (wb: string) => {
    navigator.clipboard.writeText(wb);
    setCopiedWaybill(wb);
    toast({ title: "WAY BILL Copied", description: wb });
    setTimeout(() => setCopiedWaybill(null), 2000);
  };

  const fetchOrders = async () => {
    try {
      let query = supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (orderTypeFilter === "standard") {
        query = query.eq("is_preorder", false);
      } else if (orderTypeFilter === "preorder") {
        query = query.eq("is_preorder", true);
      }

      const { data, error } = await query;

      if (error) throw error;
      setOrders(data || []);
    } catch (error: any) {
      toast({
        title: "Error fetching orders",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [statusFilter, orderTypeFilter]);

  // District statistical circle chart data
  const districtData = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach((o) => {
      const dist = (o.district || "Unspecified").trim();
      const formatted = dist.charAt(0).toUpperCase() + dist.slice(1);
      counts[formatted] = (counts[formatted] || 0) + 1;
    });

    const total = orders.length;
    return Object.entries(counts)
      .map(([name, value]) => ({
        name,
        value,
        percentage: total > 0 ? Math.round((value / total) * 100) : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [orders]);

  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return orders;
    const q = searchQuery.toLowerCase().trim();
    return orders.filter((o) => {
      const name = (o.customer_name || "").toLowerCase();
      const p1 = (o.customer_phone || "").toLowerCase();
      const p2 = (o.secondary_phone || "").toLowerCase();
      const wb = (o.waybill_number || "").toLowerCase();
      const id = (o.id || "").toLowerCase();
      const dist = (o.district || "").toLowerCase();
      return (
        name.includes(q) ||
        p1.includes(q) ||
        p2.includes(q) ||
        wb.includes(q) ||
        id.includes(q) ||
        dist.includes(q)
      );
    });
  }, [orders, searchQuery]);

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: newStatus })
        .eq("id", orderId);

      if (error) throw error;
      toast({ title: "Order status updated" });
      fetchOrders();
      
      if (selectedOrder?.id === orderId) {
        setSelectedOrder({ ...selectedOrder, status: newStatus });
      }
    } catch (error: any) {
      toast({
        title: "Error updating order",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const deleteOrder = async (orderId: string) => {
    try {
      const { error } = await supabase.from("orders").delete().eq("id", orderId);
      if (error) throw error;
      toast({ title: "Order deleted" });
      if (selectedOrder?.id === orderId) setSelectedOrder(null);
      fetchOrders();
    } catch (error: any) {
      toast({ title: "Error deleting order", description: error.message, variant: "destructive" });
    }
  };

  const exportOrders = (type: "csv" | "excel") => {
    if (orders.length === 0) {
      toast({ title: "No orders to export", variant: "destructive" });
      return;
    }

    // Exact columns matching courier bulk upload template (Image 1):
    // Waybill Number, Order Number, Customer Name, Address, Order Description, Customer First Phone No, Customer Second Phone No, COD Amount, City, Remarks
    const headers = [
      "Waybill Number",
      "Order Number",
      "Customer Name",
      "Address",
      "Order Description",
      "Customer First Phone No",
      "Customer Second Phone No",
      "COD Amount",
      "City",
      "Remarks",
    ];

    const rows = orders.map((o) => {
      const items = Array.isArray(o.order_items)
        ? (o.order_items as any[]).map((i: any) => `${i.name} x${i.quantity || 1}`).join("; ")
        : "";

      // COD Amount is only charged if payment method is Cash on Delivery
      const codAmount = o.payment_method === "cod" ? Number(o.total_amount) || 0 : 0;
      const remarks = o.special_instructions
        ? `${o.special_instructions}${o.is_preorder ? " (Pre-Order)" : ""}`
        : o.is_preorder ? "Pre-Order" : "";

      return [
        o.waybill_number || "",
        o.id.slice(0, 8),
        o.customer_name || "",
        o.customer_address || "",
        items,
        o.customer_phone || "",
        o.secondary_phone || "",
        codAmount,
        o.district || "",
        remarks,
      ];
    });

    const filterLabel = statusFilter === "all" ? "all" : statusFilter;
    const dateStr = format(new Date(), "yyyy-MM-dd");

    if (type === "excel") {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws["!cols"] = [
        { wch: 18 }, // Waybill Number
        { wch: 15 }, // Order Number
        { wch: 22 }, // Customer Name
        { wch: 38 }, // Address
        { wch: 30 }, // Order Description
        { wch: 24 }, // Customer First Phone No
        { wch: 24 }, // Customer Second Phone No
        { wch: 14 }, // COD Amount
        { wch: 18 }, // City
        { wch: 22 }, // Remarks
      ];
      XLSX.utils.book_append_sheet(wb, ws, "excel_upload");
      XLSX.writeFile(wb, `excel_upload-${filterLabel}-${dateStr}.xlsx`);
    } else {
      const csvContent = [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");

      const BOM = "\uFEFF";
      const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `excel_upload-${filterLabel}-${dateStr}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    toast({ title: `Orders exported as ${type === "excel" ? "Excel" : "CSV"} (Courier Template)` });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <LimitWarningBanner type="orders" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Orders</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Manage customer orders from WhatsApp
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Toggle buttons for Order Type */}
            <div className="inline-flex rounded-lg border bg-muted p-1 text-muted-foreground text-xs">
              <button
                type="button"
                onClick={() => setOrderTypeFilter("all")}
                className={`px-3 py-1 font-medium rounded-md transition-all ${
                  orderTypeFilter === "all" ? "bg-background text-foreground shadow-sm" : "hover:text-foreground"
                }`}
              >
                All Orders
              </button>
              <button
                type="button"
                onClick={() => setOrderTypeFilter("standard")}
                className={`px-3 py-1 font-medium rounded-md transition-all ${
                  orderTypeFilter === "standard" ? "bg-background text-foreground shadow-sm" : "hover:text-foreground"
                }`}
              >
                Standard
              </button>
              <button
                type="button"
                onClick={() => setOrderTypeFilter("preorder")}
                className={`px-3 py-1 font-medium rounded-md transition-all ${
                  orderTypeFilter === "preorder" ? "bg-amber-500 text-white shadow-sm font-semibold" : "hover:text-foreground"
                }`}
              >
                Pre-Orders
              </button>
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {statusOptions.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Toggle button for District Insights */}
            <Button
              variant={showDistrictAnalytics ? "default" : "outline"}
              size="sm"
              onClick={() => setShowDistrictAnalytics(!showDistrictAnalytics)}
              className="gap-1.5 text-xs"
            >
              <PieChartIcon className="h-4 w-4" />
              {showDistrictAnalytics ? "Hide Analytics" : "District Insights"}
            </Button>

            {/* Search filter */}
            <div className="relative w-full sm:w-60">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search phone, waybill, name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>

            {/* Import Waybills button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsWaybillModalOpen(true)}
              className="gap-1.5 text-xs border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              Import Waybills
            </Button>

            {/* Send WhatsApp Waybills button */}
            <Button
              variant="default"
              size="sm"
              onClick={() => handleOpenSendWaybill(null)}
              className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
              title="Send tracking waybills directly to customers via WhatsApp"
            >
              <MessageCircle className="h-4 w-4" />
              Notify Waybills
              {pendingWaybillCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-white text-emerald-700 shadow-sm">
                  {pendingWaybillCount}
                </span>
              )}
            </Button>

            <Button variant="outline" size="sm" onClick={() => exportOrders("csv")} disabled={orders.length === 0}>
              <Download className="mr-1.5 h-4 w-4" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportOrders("excel")} disabled={orders.length === 0}>
              <Download className="mr-1.5 h-4 w-4" />
              Excel
            </Button>
          </div>
        </div>

        {/* District Insights Donut Chart Card */}
        {showDistrictAnalytics && (
          <Card className="border shadow-sm bg-gradient-to-br from-background to-slate-50/50">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <PieChartIcon className="h-5 w-5 text-primary" />
                    District Orders Distribution
                  </CardTitle>
                  <CardDescription>
                    Statistical circular breakdown of orders by customer delivery district
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-xs">
                  {districtData.length} District{districtData.length !== 1 ? "s" : ""}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {districtData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No district information recorded yet in orders.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center pt-2">
                  <div className="h-[230px] w-full flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={districtData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={85}
                          paddingAngle={3}
                          stroke="#fff"
                          strokeWidth={2}
                        >
                          {districtData.map((_, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={DISTRICT_COLORS[index % DISTRICT_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          formatter={(value: any, name: any) => [`${value} Orders`, name]}
                          contentStyle={{
                            backgroundColor: "rgba(255, 255, 255, 0.96)",
                            borderRadius: "8px",
                            border: "1px solid #e2e8f0",
                            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                            fontSize: "12px",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Top Customer Districts
                    </p>
                    {districtData.map((d, index) => (
                      <div
                        key={d.name}
                        className="flex items-center justify-between text-sm p-1.5 rounded hover:bg-slate-100/70 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 rounded-full shrink-0"
                            style={{
                              backgroundColor: DISTRICT_COLORS[index % DISTRICT_COLORS.length],
                            }}
                          />
                          <span className="font-medium text-slate-800">{d.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-600">
                            {d.value} {d.value === 1 ? "order" : "orders"}
                          </span>
                          <Badge variant="secondary" className="text-[11px] px-1.5 py-0 font-normal">
                            {d.percentage}%
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Order List</CardTitle>
            <CardDescription>
              {filteredOrders.length} order{filteredOrders.length !== 1 ? "s" : ""} found {orderTypeFilter !== "all" ? `(${orderTypeFilter})` : ""}{searchQuery ? ` matching "${searchQuery}"` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="text-center py-8">
                <ShoppingCart className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  {searchQuery ? "No orders found matching your search." : "No orders found."}
                </p>
              </div>
            ) : (
              <>
                {/* Mobile: Card layout */}
                <div className="space-y-3 md:hidden">
                  {filteredOrders.map((order) => (
                    <div key={order.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{order.customer_name}</p>
                            {order.is_preorder && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                                ⏳ Pre-Order
                              </span>
                            )}
                          </div>
                          <div className="text-xs font-mono space-y-0.5 mt-1">
                            <p className="text-foreground flex items-center gap-1 font-medium">
                              <span className="text-[10px] text-muted-foreground font-sans">No-1:</span>
                              {order.customer_phone}
                            </p>
                            {order.secondary_phone && (
                              <p className="text-slate-500 flex items-center gap-1">
                                <span className="text-[10px] text-muted-foreground font-sans">No-2:</span>
                                {order.secondary_phone}
                              </p>
                            )}
                          </div>
                          {order.waybill_number && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleCopyWaybill(order.waybill_number!)}
                                className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-200"
                              >
                                {copiedWaybill === order.waybill_number ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                WB: {order.waybill_number}
                              </button>
                              {order.waybill_sent_at ? (
                                <Badge
                                  variant="outline"
                                  onClick={() => handleOpenSendWaybill(order.id)}
                                  className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300 cursor-pointer"
                                  title={`Sent on ${format(new Date(order.waybill_sent_at), "MMM d, h:mm a")}. Tap to resend.`}
                                >
                                  <CheckCircle2 className="h-2.5 w-2.5 mr-1 text-emerald-600" />
                                  Sent {format(new Date(order.waybill_sent_at), "dd/MM")}
                                </Badge>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleOpenSendWaybill(order.id)}
                                  className="inline-flex items-center gap-1 text-[10px] font-medium bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-0.5 rounded"
                                >
                                  <Send className="h-2.5 w-2.5" /> Send WA
                                </button>
                              )}
                            </div>
                          )}
                          {order.district && (
                            <p className="text-xs text-slate-600 flex items-center gap-1 mt-1">
                              <MapPin className="h-3 w-3 text-slate-400" />
                              {order.district}
                            </p>
                          )}
                        </div>
                        <Badge className={statusColors[order.status]}>{order.status}</Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">LKR {order.total_amount.toFixed(2)}</span>
                        <span className="text-muted-foreground">{format(new Date(order.created_at), "MMM d, yyyy")}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="flex-1" onClick={() => setSelectedOrder(order)}>
                          <Eye className="mr-2 h-4 w-4" />
                          View Details
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Order</AlertDialogTitle>
                              <AlertDialogDescription>This will permanently delete this order. This action cannot be undone.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteOrder(order.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop: Table layout */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>District</TableHead>
                        <TableHead>Phone (No-1 / No-2)</TableHead>
                        <TableHead>WAY BILL</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrders.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="font-medium">{order.customer_name}</TableCell>
                          <TableCell>
                            {order.is_preorder ? (
                              <Badge className="bg-amber-100 text-amber-900 border-amber-300 font-medium">
                                ⏳ Pre-Order
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-slate-600 font-normal">
                                Standard
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs font-medium">
                            {order.district ? (
                              <span className="inline-flex items-center gap-1 text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                                <MapPin className="h-3 w-3 text-slate-400" />
                                {order.district}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="space-y-0.5 font-mono">
                              <div className="text-foreground font-medium flex items-center gap-1">
                                <span className="text-[10px] text-muted-foreground font-sans">No-1:</span>
                                {order.customer_phone}
                              </div>
                              {order.secondary_phone ? (
                                <div className="text-slate-500 flex items-center gap-1">
                                  <span className="text-[10px] text-muted-foreground font-sans">No-2:</span>
                                  {order.secondary_phone}
                                </div>
                              ) : (
                                <span className="text-[10px] text-muted-foreground/50 italic font-sans">-</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {order.waybill_number ? (
                              <div className="space-y-1">
                                <button
                                  type="button"
                                  onClick={() => handleCopyWaybill(order.waybill_number!)}
                                  title="Click to copy WAY BILL"
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                                >
                                  {copiedWaybill === order.waybill_number ? (
                                    <Check className="h-3 w-3 text-emerald-600" />
                                  ) : (
                                    <Copy className="h-3 w-3 text-emerald-600" />
                                  )}
                                  {order.waybill_number}
                                </button>
                                <div>
                                  {order.waybill_sent_at ? (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300 font-normal cursor-pointer hover:bg-emerald-100"
                                      onClick={() => handleOpenSendWaybill(order.id)}
                                      title={`Tracking sent to ${order.whatsapp_phone || "customer"} on ${format(
                                        new Date(order.waybill_sent_at),
                                        "MMM d, h:mm a"
                                      )}. Click to resend.`}
                                    >
                                      <CheckCircle2 className="h-2.5 w-2.5 mr-1 text-emerald-600" />
                                      Sent {format(new Date(order.waybill_sent_at), "dd/MM")}
                                    </Badge>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenSendWaybill(order.id)}
                                      className="inline-flex items-center gap-1 text-[10px] font-medium bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-0.5 rounded shadow-sm transition-all"
                                      title="Send tracking directly to customer's WhatsApp chat"
                                    >
                                      <Send className="h-2.5 w-2.5" /> Send WA
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground/60 font-normal text-[10px]">
                                No Waybill
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>LKR {order.total_amount.toFixed(2)}</TableCell>
                          <TableCell className="capitalize">
                            {order.payment_method === "cod" ? "Cash on Delivery" : "Bank Transfer"}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={order.status}
                              onValueChange={(value) => updateOrderStatus(order.id, value)}
                            >
                              <SelectTrigger className="w-[130px]">
                                <Badge className={statusColors[order.status]}>
                                  {order.status}
                                </Badge>
                              </SelectTrigger>
                              <SelectContent>
                                {statusOptions.map((status) => (
                                  <SelectItem key={status.value} value={status.value}>
                                    {status.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            {format(new Date(order.created_at), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" onClick={() => setSelectedOrder(order)}>
                                <Eye className="h-4 w-4" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Order</AlertDialogTitle>
                                    <AlertDialogDescription>This will permanently delete this order. This action cannot be undone.</AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deleteOrder(order.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Order Details Dialog */}
        <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Order Details</DialogTitle>
              <DialogDescription>
                Order #{selectedOrder?.id.slice(0, 8)}
              </DialogDescription>
            </DialogHeader>
            {selectedOrder && (
              <div className="space-y-6">
                {selectedOrder.is_preorder && (
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3 flex items-start gap-2 text-amber-900 text-sm">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Pre-Order (Estimated Availability: ~2 Weeks)</p>
                      <p className="text-xs text-amber-700">This order contains out-of-stock items reserved by the customer. Stock was not deducted.</p>
                    </div>
                  </div>
                )}

                {/* Customer Info with Dual Phones */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <h4 className="font-medium text-xs text-muted-foreground">Customer Name</h4>
                    <p className="font-semibold text-sm">{selectedOrder.customer_name}</p>
                  </div>
                  <div className="space-y-1">
                    <h4 className="font-medium text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="h-3 w-3 text-emerald-600" /> Phone No-1 (Primary)
                    </h4>
                    <p className="font-mono text-sm font-semibold">{selectedOrder.customer_phone}</p>
                  </div>
                  <div className="space-y-1">
                    <h4 className="font-medium text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="h-3 w-3 text-slate-500" /> Phone No-2 (Alternative)
                    </h4>
                    <p className="font-mono text-sm">
                      {selectedOrder.secondary_phone || <span className="text-muted-foreground italic text-xs">Not provided</span>}
                    </p>
                  </div>
                </div>

                {/* Courier Waybill Info */}
                <div className="p-3.5 rounded-lg border bg-emerald-500/5 border-emerald-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-xs text-emerald-800 dark:text-emerald-400 flex items-center gap-1.5">
                      <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Courier WAY BILL Tracking Number
                    </h4>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="font-mono text-base font-bold text-foreground">
                        {selectedOrder.waybill_number ? (
                          selectedOrder.waybill_number
                        ) : (
                          <span className="text-muted-foreground text-xs font-normal">Not assigned yet (use Import Waybills)</span>
                        )}
                      </p>
                      {selectedOrder.waybill_sent_at && (
                        <Badge variant="outline" className="text-[10px] bg-emerald-100 text-emerald-800 border-emerald-300">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Sent to WA on {format(new Date(selectedOrder.waybill_sent_at), "MMM d, h:mm a")}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {selectedOrder.waybill_number && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyWaybill(selectedOrder.waybill_number!)}
                        className="h-8 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                      >
                        {copiedWaybill === selectedOrder.waybill_number ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        Copy
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => {
                          const orderId = selectedOrder.id;
                          setSelectedOrder(null);
                          handleOpenSendWaybill(orderId);
                        }}
                        className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        {selectedOrder.waybill_sent_at ? "Resend WA" : "Send WA"}
                      </Button>
                    </div>
                  )}
                </div>

                {(selectedOrder.district || selectedOrder.customer_address) && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> Shipping Location
                    </h4>
                    {selectedOrder.district && <p className="font-medium">District: {selectedOrder.district}</p>}
                    {selectedOrder.customer_address && <p>{selectedOrder.customer_address}</p>}
                  </div>
                )}

                {/* Order Items */}
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground flex items-center gap-1">
                    <Package className="h-3 w-3" /> Order Items
                  </h4>
                  <div className="border rounded-lg divide-y">
                    {(Array.isArray(selectedOrder.order_items) ? selectedOrder.order_items : []).map((item: any, index: number) => (
                      <div key={index} className="p-3 flex justify-between">
                        <div>
                          <p className="font-medium">{item.name}</p>
                          {item.variations && (
                            <p className="text-sm text-muted-foreground">
                              {Object.entries(item.variations).map(([key, value]) => `${key}: ${value}`).join(", ")}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="font-medium">LKR {item.price}</p>
                          <p className="text-sm text-muted-foreground">Qty: {item.quantity}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Payment & Total */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm text-muted-foreground flex items-center gap-1">
                      <CreditCard className="h-3 w-3" /> Payment Method
                    </h4>
                    <p className="capitalize">
                      {selectedOrder.payment_method === "cod" ? "Cash on Delivery" : "Bank Transfer"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm text-muted-foreground">Total Amount</h4>
                    <p className="text-2xl font-bold">LKR {selectedOrder.total_amount.toFixed(2)}</p>
                  </div>
                </div>

                {selectedOrder.special_instructions && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm text-muted-foreground">Special Instructions</h4>
                    <p className="text-sm bg-muted p-3 rounded-lg">{selectedOrder.special_instructions}</p>
                  </div>
                )}

                {/* Status Update */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4 border-t">
                  <div className="space-y-1">
                    <h4 className="font-medium text-sm">Update Status</h4>
                    <Select
                      value={selectedOrder.status}
                      onValueChange={(value) => updateOrderStatus(selectedOrder.id, value)}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions.map((status) => (
                          <SelectItem key={status.value} value={status.value}>
                            {status.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const chatPhone = selectedOrder.whatsapp_phone || selectedOrder.customer_phone;
                        setSelectedOrder(null);
                        navigate(`/dashboard/conversations?phone=${encodeURIComponent(chatPhone)}`);
                      }}
                    >
                      <MessageSquare className="mr-2 h-4 w-4" />
                      See Chat
                    </Button>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(selectedOrder.created_at), "PPp")}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Waybill Import Modal */}
        <WaybillImportModal
          isOpen={isWaybillModalOpen}
          onClose={() => setIsWaybillModalOpen(false)}
          onSuccess={() => {
            fetchOrders();
            // Automatically prompt to send WhatsApp tracking for the newly matched orders!
            setIsSendWaybillModalOpen(true);
          }}
          existingOrders={orders}
        />

        {/* Send Waybill Notification Modal */}
        <SendWaybillModal
          isOpen={isSendWaybillModalOpen}
          onClose={() => {
            setIsSendWaybillModalOpen(false);
            setSelectedWaybillOrderId(null);
          }}
          onSuccess={() => {
            fetchOrders();
          }}
          orders={orders}
          preSelectedOrderId={selectedWaybillOrderId}
        />
      </div>
    </DashboardLayout>
  );
}
