import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useStaffAccess } from "@/hooks/useStaffAccess";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Package, Loader2, AlertTriangle } from "lucide-react";
import VariationEditor, { type Variation } from "@/components/products/VariationEditor";
import ProductImageUpload from "@/components/products/ProductImageUpload";
import ProductVideoUpload from "@/components/products/ProductVideoUpload";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import LimitWarningBanner from "@/components/LimitWarningBanner";

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  delivery_price: number;
  product_type: string;
  stock_quantity: number | null;
  category: string;
  variations: unknown;
  images: string[];
  video_url: string | null;
  is_active: boolean;
  created_at: string;
}

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const { effectiveUserId } = useStaffAccess();
  const { canAddProduct, usage, limits, isPaused } = usePlanLimits();
  const maxImages = limits?.max_images_per_product || 1;

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [deliveryPrice, setDeliveryPrice] = useState("");
  const [stockQuantity, setStockQuantity] = useState("");
  const [category, setCategory] = useState("single");
  const [productType, setProductType] = useState("physical");
  const [variations, setVariations] = useState<Variation[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setProducts(data || []);
    } catch (error: any) {
      toast({
        title: "Error fetching products",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const resetForm = () => {
    setName("");
    setDescription("");
    setPrice("");
    setDeliveryPrice("");
    setStockQuantity("");
    setCategory("single");
    setProductType("physical");
    setVariations([]);
    setImages([]);
    setVideoUrl(null);
    setIsActive(true);
    setEditingProduct(null);
  };

  const openEditDialog = (product: Product) => {
    setEditingProduct(product);
    setName(product.name);
    setDescription(product.description || "");
    setPrice(product.price.toString());
    setDeliveryPrice(product.delivery_price?.toString() || "0");
    setStockQuantity(
      product.stock_quantity !== null && product.stock_quantity !== undefined
        ? product.stock_quantity.toString()
        : ""
    );
    setCategory(product.category || "single");
    setProductType(product.product_type);
    setVariations(Array.isArray(product.variations) ? (product.variations as Variation[]) : []);
    setImages(Array.isArray(product.images) ? product.images : []);
    setVideoUrl(product.video_url || null);
    setIsActive(product.is_active);
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const parsedStock = stockQuantity.trim() === "" ? null : Math.max(0, parseInt(stockQuantity, 10));

      const productData = {
        name,
        description: description || null,
        price: parseFloat(price),
        delivery_price: productType === "physical" ? parseFloat(deliveryPrice || "0") : 0,
        product_type: productType,
        category: category || "single",
        stock_quantity: isNaN(parsedStock as number) ? null : parsedStock,
        variations: variations as unknown as import("@/integrations/supabase/types").Json,
        images,
        video_url: videoUrl,
        is_active: isActive,
        user_id: effectiveUserId || user!.id,
      } as any;

      if (editingProduct) {
        const { error } = await supabase
          .from("products")
          .update(productData)
          .eq("id", editingProduct.id);

        if (error) throw error;
        toast({ title: "Product updated successfully" });
      } else {
        if (!canAddProduct) {
          toast({ title: "Product limit reached", description: `Your plan allows ${limits?.max_products} products. Upgrade to add more.`, variant: "destructive" });
          setSaving(false);
          return;
        }
        const { error } = await supabase
          .from("products")
          .insert([productData]);

        if (error) throw error;
        toast({ title: "Product created successfully" });
      }

      setDialogOpen(false);
      resetForm();
      fetchProducts();
    } catch (error: any) {
      toast({
        title: "Error saving product",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this product?")) return;

    try {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
      toast({ title: "Product deleted successfully" });
      fetchProducts();
    } catch (error: any) {
      toast({
        title: "Error deleting product",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <LimitWarningBanner type="products" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Products</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Manage your product catalog for the chatbot
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}>
            <div className="flex flex-col items-end">
              <DialogTrigger asChild>
                <Button disabled={isPaused || (!canAddProduct && !editingProduct)} className="w-full sm:w-auto">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Product
                </Button>
              </DialogTrigger>
              {!canAddProduct && (
                <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                  <AlertTriangle className="h-3 w-3" />
                  Limit reached ({usage?.products}/{limits?.max_products})
                </p>
              )}
            </div>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingProduct ? "Edit Product" : "Add New Product"}</DialogTitle>
                <DialogDescription>
                  {editingProduct ? "Update the product details" : "Create a new product for your catalog"}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Product Name *</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., Premium T-Shirt"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="price">Price (LKR) *</Label>
                    <Input
                      id="price"
                      type="number"
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="29.99"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="stock">Available Stock</Label>
                    <Input
                      id="stock"
                      type="number"
                      min="0"
                      step="1"
                      value={stockQuantity}
                      onChange={(e) => setStockQuantity(e.target.value)}
                      placeholder="Leave blank for unlimited"
                    />
                    <p className="text-xs text-muted-foreground">Auto-decremented when customers order</p>
                  </div>
                  {productType === "physical" ? (
                    <div className="space-y-2">
                      <Label htmlFor="delivery-price">Delivery Price (LKR)</Label>
                      <Input
                        id="delivery-price"
                        type="number"
                        step="0.01"
                        value={deliveryPrice}
                        onChange={(e) => setDeliveryPrice(e.target.value)}
                        placeholder="0.00"
                      />
                      <p className="text-xs text-muted-foreground">Delivery fee added to physical orders</p>
                    </div>
                  ) : <div />}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe your product..."
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger id="category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="single">Single Product</SelectItem>
                        <SelectItem value="combo">Combo Offer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="type">Product Type</Label>
                    <Select value={productType} onValueChange={setProductType}>
                      <SelectTrigger id="type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="physical">Physical Product</SelectItem>
                        <SelectItem value="digital">Digital Product</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center space-x-2 pt-2">
                  <Switch
                    id="active"
                    checked={isActive}
                    onCheckedChange={setIsActive}
                  />
                  <Label htmlFor="active">Active</Label>
                </div>

                <VariationEditor variations={variations} onChange={setVariations} />

                <ProductImageUpload images={images} onChange={setImages} maxImages={maxImages} />

                <ProductVideoUpload videoUrl={videoUrl} onChange={setVideoUrl} />

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : editingProduct ? (
                      "Update Product"
                    ) : (
                      "Create Product"
                    )}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Product Catalog</CardTitle>
            <CardDescription>
              {products.length} product{products.length !== 1 ? "s" : ""} in your catalog
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-8">
                <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No products yet. Add your first product to get started.</p>
              </div>
            ) : (
              <>
                {/* Mobile: Card layout */}
                <div className="space-y-3 md:hidden">
                  {products.map((product) => (
                    <div key={product.id} className="border rounded-lg p-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium">{product.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-sm text-muted-foreground capitalize">{product.product_type}</span>
                            <span className="text-muted-foreground text-xs">•</span>
                            {product.category === "combo" ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-purple-100 text-purple-800 border border-purple-200">
                                Combo Offer
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                                Single Product
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            product.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                            {product.is_active ? "Active" : "Inactive"}
                          </span>
                          {product.stock_quantity === null || product.stock_quantity === undefined ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                              Unlimited
                            </span>
                          ) : product.stock_quantity <= 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                              Out of Stock (0)
                            </span>
                          ) : product.stock_quantity <= 5 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                              Low: {product.stock_quantity}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                              Stock: {product.stock_quantity}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">LKR {product.price.toFixed(2)}</p>
                          {product.product_type === "physical" && product.delivery_price > 0 && (
                            <p className="text-xs text-muted-foreground">+LKR {product.delivery_price.toFixed(2)} delivery</p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog(product)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(product.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop: Table layout */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Stock</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {products.map((product) => (
                        <TableRow key={product.id}>
                          <TableCell className="font-medium">{product.name}</TableCell>
                          <TableCell>
                            {product.category === "combo" ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 border border-purple-200">
                                Combo Offer
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                                Single Product
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="capitalize">{product.product_type}</TableCell>
                          <TableCell>
                            LKR {product.price.toFixed(2)}
                            {product.product_type === "physical" && product.delivery_price > 0 && (
                              <span className="block text-xs text-muted-foreground">+LKR {product.delivery_price.toFixed(2)} delivery</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {product.stock_quantity === null || product.stock_quantity === undefined ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                                Unlimited
                              </span>
                            ) : product.stock_quantity <= 0 ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                                Out of Stock (0)
                              </span>
                            ) : product.stock_quantity <= 5 ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                                Low Stock: {product.stock_quantity}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                                {product.stock_quantity} in stock
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              product.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                            }`}>
                              {product.is_active ? "Active" : "Inactive"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" onClick={() => openEditDialog(product)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(product.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
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
      </div>
    </DashboardLayout>
  );
}
