import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";

type Variant = {
  id: number;
  sku: string;
  size?: string | null;
  color?: string | null;
  price: string | number;
  currency: string;
  available: number;
};

type Product = {
  id: number;
  name: string;
  slug: string;
  category?: string | null;
  brand?: string | null;
  status: string;
  price: string | number;
  currency: string;
  stock: number;
  variants: Variant[];
};

type CartLine = {
  productId: number;
  productName: string;
  variantId: number;
  sku: string;
  size?: string | null;
  color?: string | null;
  unitPrice: number;
  currency: string;
  quantity: number;
  visibleAvailable: number;
};

type OrderResult = {
  id: number;
  orderNumber: string;
  token: string;
  status: string;
  currency: string;
  subtotalMinor: number;
  grandTotalMinor: number;
};

type ViewName = "catalog" | "detail" | "cart" | "success";

const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  "https://catalog-api-production-cc18.up.railway.app";

const STOREFRONT_URL =
  process.env.EXPO_PUBLIC_STOREFRONT_URL ??
  "https://storefront-production-e7b5.up.railway.app/";

const WHATSAPP_URL = process.env.EXPO_PUBLIC_WHATSAPP_URL ?? "";

function money(value: string | number, currency = "HNL") {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("es-HN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function moneyMinor(value: number, currency = "HNL") {
  return money(Number(value || 0) / 100, currency);
}

function variantLabel(variant: Pick<Variant, "size" | "color" | "sku">) {
  return [variant.color, variant.size].filter(Boolean).join(" · ") || variant.sku;
}

function makeOrderKey() {
  return `mobile-order-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function whatsappHandoffUrl(orderNumber: string) {
  if (!WHATSAPP_URL) return null;
  const message =
    `Hola, quiero continuar la confirmación de la orden ${orderNumber} de MR עדולם.`;
  const separator = WHATSAPP_URL.includes("?") ? "&" : "?";
  return `${WHATSAPP_URL}${separator}text=${encodeURIComponent(message)}`;
}

export default function App() {
  const scheme = useColorScheme();
  const dark = scheme === "dark";

  const theme = useMemo(
    () => ({
      background: dark ? "#111111" : "#F7F2EA",
      surface: dark ? "#1B1B1B" : "#FFFFFF",
      surfaceAlt: dark ? "#24211E" : "#FBF8F3",
      text: dark ? "#F7F2EA" : "#171717",
      muted: dark ? "#BDB4A7" : "#6E665E",
      border: dark ? "#34302B" : "#E3D9CC",
      accent: "#B58A3A",
      danger: dark ? "#F2A8A8" : "#8C2F2F",
      success: dark ? "#A8D8B8" : "#245E38",
    }),
    [dark],
  );

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [view, setView] = useState<ViewName>("catalog");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderError, setOrderError] = useState<string | null>(null);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderAttemptKey, setOrderAttemptKey] = useState<string | null>(null);
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setCatalogError(null);

    try {
      const response = await fetch(
        `${API_BASE.replace(/\/$/, "")}/v1/products?status=active`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as { data?: Product[] };
      setProducts(Array.isArray(payload.data) ? payload.data : []);
    } catch {
      setCatalogError("No se pudo cargar el catálogo. Intenta nuevamente.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cartCount = useMemo(
    () => cart.reduce((sum, line) => sum + line.quantity, 0),
    [cart],
  );

  const cartTotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    [cart],
  );

  const cartCurrency = cart[0]?.currency || "HNL";

  const invalidateOrderAttempt = useCallback(() => {
    setOrderAttemptKey(null);
    setOrderError(null);
  }, []);

  const openProduct = useCallback((product: Product) => {
    const available = (product.variants || []).filter(
      (variant) => Number(variant.available) > 0,
    );
    setSelectedProduct(product);
    setSelectedVariantId(available[0]?.id ?? null);
    setOrderError(null);
    setView("detail");
  }, []);

  const selectedVariant = useMemo(() => {
    if (!selectedProduct || selectedVariantId == null) return null;
    return (
      selectedProduct.variants.find(
        (variant) => Number(variant.id) === Number(selectedVariantId),
      ) ?? null
    );
  }, [selectedProduct, selectedVariantId]);

  const addToCart = useCallback(() => {
    if (!selectedProduct || !selectedVariant) return;
    const available = Number(selectedVariant.available || 0);
    if (available < 1) return;

    setCart((current) => {
      const existing = current.find(
        (line) => line.variantId === selectedVariant.id,
      );
      if (existing) {
        return current.map((line) =>
          line.variantId === selectedVariant.id
            ? {
                ...line,
                visibleAvailable: available,
                quantity: Math.min(line.quantity + 1, available),
              }
            : line,
        );
      }

      return [
        ...current,
        {
          productId: selectedProduct.id,
          productName: selectedProduct.name,
          variantId: selectedVariant.id,
          sku: selectedVariant.sku,
          size: selectedVariant.size,
          color: selectedVariant.color,
          unitPrice: Number(selectedVariant.price || 0),
          currency: selectedVariant.currency || "HNL",
          quantity: 1,
          visibleAvailable: available,
        },
      ];
    });

    invalidateOrderAttempt();
  }, [invalidateOrderAttempt, selectedProduct, selectedVariant]);

  const setLineQuantity = useCallback(
    (variantId: number, nextQuantity: number) => {
      setCart((current) =>
        current.flatMap((line) => {
          if (line.variantId !== variantId) return [line];
          if (nextQuantity <= 0) return [];
          return [
            {
              ...line,
              quantity: Math.min(nextQuantity, line.visibleAvailable),
            },
          ];
        }),
      );
      invalidateOrderAttempt();
    },
    [invalidateOrderAttempt],
  );

  const beginNewShopping = useCallback(() => {
    setOrderResult(null);
    setSelectedProduct(null);
    setSelectedVariantId(null);
    setOrderError(null);
    setView("catalog");
  }, []);

  const submitOrder = useCallback(async () => {
    if (submittingOrder) return;

    const name = customerName.trim();
    const phone = customerPhone.trim();

    if (!name) {
      setOrderError("Ingresa el nombre de la persona que recibirá la orden.");
      return;
    }
    if (!phone) {
      setOrderError("Ingresa un teléfono para confirmar la orden.");
      return;
    }
    if (!cart.length) {
      setOrderError("Tu carrito está vacío.");
      return;
    }

    const key = orderAttemptKey || makeOrderKey();
    if (!orderAttemptKey) setOrderAttemptKey(key);

    setSubmittingOrder(true);
    setOrderError(null);

    try {
      const response = await fetch(`${API_BASE.replace(/\/$/, "")}/v1/orders`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify({
          channel: "APP",
          customer: {
            name,
            phone,
          },
          items: cart.map((line) => ({
            variantId: line.variantId,
            quantity: line.quantity,
          })),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        order?: OrderResult;
        replayed?: boolean;
      };

      if (response.status === 409 && payload.error === "insufficient_stock") {
        setOrderAttemptKey(null);
        setOrderError(
          "El inventario cambió mientras comprabas. Actualizamos el catálogo para que elijas la disponibilidad vigente.",
        );
        await load(true);
        return;
      }

      if (
        response.status === 409 &&
        payload.error === "idempotency_conflict"
      ) {
        setOrderAttemptKey(null);
        setOrderError(
          "El intento anterior ya tenía un contenido distinto. Revisa el carrito e intenta de nuevo.",
        );
        return;
      }

      if (!response.ok || !payload.order) {
        setOrderError(
          "No pudimos crear la orden. Puedes reintentar sin duplicarla.",
        );
        return;
      }

      setOrderResult(payload.order);
      setOrderAttemptKey(null);
      setCart([]);
      setView("success");
      await load(true);
    } catch {
      setOrderError(
        "No pudimos confirmar si la red recibió tu solicitud. Reintenta: el mismo intento se enviará sin duplicar la orden.",
      );
    } finally {
      setSubmittingOrder(false);
    }
  }, [
    cart,
    customerName,
    customerPhone,
    load,
    orderAttemptKey,
    submittingOrder,
  ]);

  const openHandoff = useCallback(async () => {
    if (!orderResult) return;

    const whatsapp = whatsappHandoffUrl(orderResult.orderNumber);
    const target = whatsapp || STOREFRONT_URL;

    try {
      await Linking.openURL(target);
    } catch {
      setOrderError(
        "No se pudo abrir el canal externo. Conserva tu número de orden para continuar.",
      );
    }
  }, [orderResult]);

  const header = (
    <View style={styles.header}>
      {view !== "catalog" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver"
          onPress={() => {
            setOrderError(null);
            setView(view === "success" ? "catalog" : "catalog");
          }}
          style={({ pressed }) => [
            styles.iconButton,
            {
              borderColor: theme.border,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <Text style={[styles.iconButtonText, { color: theme.text }]}>‹</Text>
        </Pressable>
      ) : (
        <Image source={require("./assets/icon.png")} style={styles.logo} />
      )}

      <View style={styles.headerCopy}>
        <Text style={[styles.brand, { color: theme.text }]}>MR עדולם</Text>
        <Text style={[styles.subtitle, { color: theme.muted }]}>
          {view === "detail"
            ? "Detalle de producto"
            : view === "cart"
              ? "Carrito móvil"
              : view === "success"
                ? "Orden reservada"
                : "Catálogo móvil"}
        </Text>
      </View>

      {view !== "success" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Abrir carrito, ${cartCount} producto(s)`}
          onPress={() => setView("cart")}
          style={({ pressed }) => [
            styles.cartButton,
            {
              borderColor: theme.border,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <Text style={[styles.cartButtonText, { color: theme.text }]}>
            Bolsa {cartCount ? `(${cartCount})` : ""}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir tienda web"
          onPress={() => void Linking.openURL(STOREFRONT_URL)}
          style={({ pressed }) => [
            styles.webButton,
            {
              borderColor: theme.border,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <Text style={[styles.webButtonText, { color: theme.text }]}>Web</Text>
        </Pressable>
      )}
    </View>
  );

  const catalogView = loading ? (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={theme.accent} />
      <Text style={[styles.stateText, { color: theme.muted }]}>
        Cargando catálogo…
      </Text>
    </View>
  ) : catalogError ? (
    <View style={styles.center}>
      <Text style={[styles.stateTitle, { color: theme.text }]}>
        Catálogo no disponible
      </Text>
      <Text style={[styles.stateText, { color: theme.muted }]}>
        {catalogError}
      </Text>
      <Pressable
        onPress={() => void load()}
        style={[styles.primaryButton, { backgroundColor: theme.text }]}
      >
        <Text style={[styles.primaryButtonText, { color: theme.background }]}>
          Reintentar
        </Text>
      </Pressable>
    </View>
  ) : (
    <FlatList
      data={products}
      keyExtractor={(item) => String(item.id)}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load(true)}
          tintColor={theme.accent}
        />
      }
      ListHeaderComponent={
        <View style={styles.intro}>
          <Text style={[styles.kicker, { color: theme.accent }]}>
            MR עדולם
          </Text>
          <Text style={[styles.title, { color: theme.text }]}>
            Elige la variante exacta
          </Text>
          <Text style={[styles.body, { color: theme.muted }]}>
            Precios y disponibilidad provienen del Commerce Core. El carrito
            móvil puede crear una reserva de orden real para continuar la
            confirmación.
          </Text>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.centerCompact}>
          <Text style={[styles.stateTitle, { color: theme.text }]}>
            Sin productos activos
          </Text>
          <Text style={[styles.stateText, { color: theme.muted }]}>
            El catálogo aparecerá aquí cuando haya inventario publicado.
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        const availableVariants = (item.variants ?? []).filter(
          (variant) => Number(variant.available) > 0,
        );

        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ver ${item.name}`}
            onPress={() => openProduct(item)}
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <View style={styles.cardTop}>
              <View style={styles.cardCopy}>
                <Text style={[styles.category, { color: theme.accent }]}>
                  {item.category || "Catálogo"}
                </Text>
                <Text style={[styles.productName, { color: theme.text }]}>
                  {item.name}
                </Text>
              </View>
              <Text style={[styles.price, { color: theme.text }]}>
                {money(item.price, item.currency || "HNL")}
              </Text>
            </View>

            <Text style={[styles.stock, { color: theme.muted }]}>
              {Number(item.stock) > 0
                ? `${item.stock} unidad(es) · ${availableVariants.length} variante(s) disponibles`
                : "Agotado"}
            </Text>

            {availableVariants.length > 0 ? (
              <View style={styles.chips}>
                {availableVariants.slice(0, 4).map((variant) => (
                  <View
                    key={variant.id}
                    style={[styles.chip, { borderColor: theme.border }]}
                  >
                    <Text style={[styles.chipText, { color: theme.muted }]}>
                      {variantLabel(variant)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Text style={[styles.cardLink, { color: theme.accent }]}>
              Ver variantes →
            </Text>
          </Pressable>
        );
      }}
    />
  );

  const detailView = selectedProduct ? (
    <ScrollView
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={[
          styles.detailHero,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
          },
        ]}
      >
        <Text style={[styles.category, { color: theme.accent }]}>
          {selectedProduct.category || "Catálogo"}
        </Text>
        <Text style={[styles.detailTitle, { color: theme.text }]}>
          {selectedProduct.name}
        </Text>
        <Text style={[styles.body, { color: theme.muted }]}>
          {selectedProduct.brand
            ? `Marca: ${selectedProduct.brand}`
            : "Selecciona talla, color o SKU disponible."}
        </Text>
      </View>

      <Text style={[styles.sectionTitle, { color: theme.text }]}>
        Variantes
      </Text>

      <View style={styles.variantStack}>
        {(selectedProduct.variants || []).map((variant) => {
          const available = Number(variant.available || 0);
          const selected = selectedVariantId === variant.id;
          return (
            <Pressable
              key={variant.id}
              accessibilityRole="radio"
              accessibilityState={{
                selected,
                disabled: available < 1,
              }}
              disabled={available < 1}
              onPress={() => setSelectedVariantId(variant.id)}
              style={({ pressed }) => [
                styles.variantRow,
                {
                  backgroundColor: selected ? theme.surfaceAlt : theme.surface,
                  borderColor: selected ? theme.accent : theme.border,
                  opacity: available < 1 ? 0.45 : pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={styles.variantCopy}>
                <Text style={[styles.variantName, { color: theme.text }]}>
                  {variantLabel(variant)}
                </Text>
                <Text style={[styles.variantSku, { color: theme.muted }]}>
                  SKU {variant.sku}
                </Text>
              </View>
              <View style={styles.variantMeta}>
                <Text style={[styles.variantPrice, { color: theme.text }]}>
                  {money(variant.price, variant.currency || "HNL")}
                </Text>
                <Text
                  style={[
                    styles.variantAvailability,
                    {
                      color:
                        available > 0 ? theme.success : theme.danger,
                    },
                  ]}
                >
                  {available > 0 ? `${available} disponibles` : "Agotado"}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View
        style={[
          styles.notice,
          {
            backgroundColor: theme.surfaceAlt,
            borderColor: theme.border,
          },
        ]}
      >
        <Text style={[styles.noticeTitle, { color: theme.text }]}>
          Inventario autoritativo
        </Text>
        <Text style={[styles.noticeText, { color: theme.muted }]}>
          La disponibilidad se vuelve a validar al crear la orden. Si otra
          persona toma la última unidad, el servidor pedirá actualizar.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={!selectedVariant || Number(selectedVariant.available) < 1}
        onPress={addToCart}
        style={[
          styles.primaryButtonWide,
          {
            backgroundColor:
              selectedVariant && Number(selectedVariant.available) > 0
                ? theme.text
                : theme.border,
          },
        ]}
      >
        <Text
          style={[
            styles.primaryButtonText,
            { color: theme.background },
          ]}
        >
          Añadir a la bolsa
        </Text>
      </Pressable>

      {cartCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setView("cart")}
          style={[styles.secondaryButtonWide, { borderColor: theme.border }]}
        >
          <Text style={[styles.secondaryButtonText, { color: theme.text }]}>
            Ver bolsa ({cartCount})
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  ) : (
    <View style={styles.center}>
      <Text style={[styles.stateText, { color: theme.muted }]}>
        Producto no seleccionado.
      </Text>
    </View>
  );

  const cartView = (
    <ScrollView
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: theme.text }]}>Tu bolsa</Text>
      <Text style={[styles.body, { color: theme.muted }]}>
        El total mostrado es informativo. Commerce Core vuelve a calcular
        precios e inventario al crear la orden.
      </Text>

      {!cart.length ? (
        <View style={styles.centerCompact}>
          <Text style={[styles.stateTitle, { color: theme.text }]}>
            Tu bolsa está vacía
          </Text>
          <Pressable
            onPress={() => setView("catalog")}
            style={[styles.primaryButton, { backgroundColor: theme.text }]}
          >
            <Text
              style={[
                styles.primaryButtonText,
                { color: theme.background },
              ]}
            >
              Ver productos
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.cartLines}>
            {cart.map((line) => (
              <View
                key={line.variantId}
                style={[
                  styles.cartLine,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                  },
                ]}
              >
                <View style={styles.cartLineTop}>
                  <View style={styles.cardCopy}>
                    <Text style={[styles.productName, { color: theme.text }]}>
                      {line.productName}
                    </Text>
                    <Text style={[styles.variantSku, { color: theme.muted }]}>
                      {variantLabel(line)} · {line.sku}
                    </Text>
                  </View>
                  <Text style={[styles.price, { color: theme.text }]}>
                    {money(
                      line.unitPrice * line.quantity,
                      line.currency,
                    )}
                  </Text>
                </View>

                <View style={styles.quantityRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Reducir ${line.productName}`}
                    onPress={() =>
                      setLineQuantity(line.variantId, line.quantity - 1)
                    }
                    style={[
                      styles.quantityButton,
                      { borderColor: theme.border },
                    ]}
                  >
                    <Text style={[styles.quantityText, { color: theme.text }]}>
                      −
                    </Text>
                  </Pressable>

                  <Text style={[styles.quantityValue, { color: theme.text }]}>
                    {line.quantity}
                  </Text>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Aumentar ${line.productName}`}
                    disabled={line.quantity >= line.visibleAvailable}
                    onPress={() =>
                      setLineQuantity(line.variantId, line.quantity + 1)
                    }
                    style={[
                      styles.quantityButton,
                      {
                        borderColor: theme.border,
                        opacity:
                          line.quantity >= line.visibleAvailable ? 0.35 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.quantityText, { color: theme.text }]}>
                      +
                    </Text>
                  </Pressable>

                  <Text style={[styles.stockInline, { color: theme.muted }]}>
                    máx. visible {line.visibleAvailable}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          <View
            style={[
              styles.summary,
              {
                backgroundColor: theme.surfaceAlt,
                borderColor: theme.border,
              },
            ]}
          >
            <Text style={[styles.summaryLabel, { color: theme.muted }]}>
              Total informativo de productos
            </Text>
            <Text style={[styles.summaryValue, { color: theme.text }]}>
              {money(cartTotal, cartCurrency)}
            </Text>
          </View>

          <View style={styles.formSection}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Datos para confirmar
            </Text>

            <TextInput
              accessibilityLabel="Nombre"
              value={customerName}
              onChangeText={(value) => {
                setCustomerName(value);
                invalidateOrderAttempt();
              }}
              placeholder="Nombre"
              placeholderTextColor={theme.muted}
              autoCapitalize="words"
              style={[
                styles.input,
                {
                  color: theme.text,
                  borderColor: theme.border,
                  backgroundColor: theme.surface,
                },
              ]}
            />

            <TextInput
              accessibilityLabel="Teléfono"
              value={customerPhone}
              onChangeText={(value) => {
                setCustomerPhone(value);
                invalidateOrderAttempt();
              }}
              placeholder="Teléfono"
              placeholderTextColor={theme.muted}
              keyboardType="phone-pad"
              style={[
                styles.input,
                {
                  color: theme.text,
                  borderColor: theme.border,
                  backgroundColor: theme.surface,
                },
              ]}
            />
          </View>

          {orderError ? (
            <View
              style={[
                styles.errorBox,
                {
                  borderColor: theme.danger,
                  backgroundColor: theme.surface,
                },
              ]}
            >
              <Text style={[styles.errorText, { color: theme.danger }]}>
                {orderError}
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={submittingOrder}
            onPress={() => void submitOrder()}
            style={[
              styles.primaryButtonWide,
              {
                backgroundColor: submittingOrder
                  ? theme.border
                  : theme.text,
              },
            ]}
          >
            {submittingOrder ? (
              <ActivityIndicator color={theme.background} />
            ) : (
              <Text
                style={[
                  styles.primaryButtonText,
                  { color: theme.background },
                ]}
              >
                Crear reserva de orden
              </Text>
            )}
          </Pressable>

          <Text style={[styles.legalNote, { color: theme.muted }]}>
            Crear la reserva no significa que el pago esté realizado. El equipo
            debe continuar la confirmación, entrega y pago por los canales
            habilitados.
          </Text>
        </>
      )}
    </ScrollView>
  );

  const successView = orderResult ? (
    <ScrollView contentContainerStyle={styles.successScreen}>
      <View
        style={[
          styles.successCard,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
          },
        ]}
      >
        <Text style={[styles.kicker, { color: theme.success }]}>
          Reserva creada
        </Text>
        <Text style={[styles.successTitle, { color: theme.text }]}>
          {orderResult.orderNumber}
        </Text>
        <Text style={[styles.body, { color: theme.muted }]}>
          La orden quedó registrada en Commerce Core como{" "}
          {orderResult.status}. Aún no representa un pago confirmado.
        </Text>

        <View
          style={[
            styles.summary,
            {
              backgroundColor: theme.surfaceAlt,
              borderColor: theme.border,
            },
          ]}
        >
          <Text style={[styles.summaryLabel, { color: theme.muted }]}>
            Productos reservados
          </Text>
          <Text style={[styles.summaryValue, { color: theme.text }]}>
            {moneyMinor(
              orderResult.subtotalMinor,
              orderResult.currency || "HNL",
            )}
          </Text>
          <Text style={[styles.summaryFoot, { color: theme.muted }]}>
            Entrega y forma de pago se cierran en el siguiente paso.
          </Text>
        </View>

        {orderError ? (
          <Text style={[styles.errorText, { color: theme.danger }]}>
            {orderError}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => void openHandoff()}
          style={[styles.primaryButtonWide, { backgroundColor: theme.text }]}
        >
          <Text
            style={[
              styles.primaryButtonText,
              { color: theme.background },
            ]}
          >
            {WHATSAPP_URL
              ? "Continuar por WhatsApp"
              : "Continuar en la tienda web"}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={beginNewShopping}
          style={[styles.secondaryButtonWide, { borderColor: theme.border }]}
        >
          <Text style={[styles.secondaryButtonText, { color: theme.text }]}>
            Seguir comprando
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  ) : (
    <View style={styles.center}>
      <Text style={[styles.stateText, { color: theme.muted }]}>
        No hay una orden reciente.
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <StatusBar
        barStyle={dark ? "light-content" : "dark-content"}
        backgroundColor={theme.background}
      />
      {header}
      {view === "catalog"
        ? catalogView
        : view === "detail"
          ? detailView
          : view === "cart"
            ? cartView
            : successView}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    minHeight: 76,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  logo: { width: 42, height: 42, borderRadius: 10 },
  headerCopy: { flex: 1 },
  brand: { fontSize: 20, fontWeight: "700", letterSpacing: 0.3 },
  subtitle: { marginTop: 2, fontSize: 13 },
  iconButton: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonText: { fontSize: 30, lineHeight: 34, fontWeight: "400" },
  cartButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  cartButtonText: { fontSize: 13, fontWeight: "800" },
  webButton: {
    minHeight: 44,
    minWidth: 58,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  webButtonText: { fontSize: 14, fontWeight: "700" },
  list: { padding: 20, paddingTop: 6, paddingBottom: 44, gap: 12 },
  screen: { padding: 20, paddingTop: 6, paddingBottom: 48 },
  successScreen: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
    paddingBottom: 48,
  },
  intro: { marginBottom: 18 },
  kicker: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  title: { marginTop: 6, fontSize: 30, lineHeight: 34, fontWeight: "800" },
  body: { marginTop: 10, fontSize: 15, lineHeight: 22 },
  card: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 12 },
  cardTop: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  cardCopy: { flex: 1 },
  category: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  productName: { marginTop: 5, fontSize: 19, lineHeight: 24, fontWeight: "700" },
  price: { fontSize: 17, fontWeight: "800" },
  stock: { fontSize: 13, lineHeight: 18 },
  cardLink: { fontSize: 13, fontWeight: "800", marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
  center: {
    flex: 1,
    padding: 28,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  centerCompact: {
    paddingVertical: 52,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  stateTitle: { fontSize: 22, fontWeight: "800", textAlign: "center" },
  stateText: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  primaryButton: {
    minHeight: 46,
    paddingHorizontal: 20,
    borderRadius: 999,
    justifyContent: "center",
  },
  primaryButtonWide: {
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  primaryButtonText: { fontWeight: "800", fontSize: 15 },
  secondaryButtonWide: {
    minHeight: 50,
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  secondaryButtonText: { fontWeight: "800", fontSize: 15 },
  detailHero: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 22,
    marginBottom: 22,
  },
  detailTitle: {
    fontSize: 30,
    lineHeight: 35,
    fontWeight: "800",
    marginTop: 7,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
    marginBottom: 12,
  },
  variantStack: { gap: 10 },
  variantRow: {
    minHeight: 78,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  variantCopy: { flex: 1 },
  variantName: { fontSize: 16, fontWeight: "800" },
  variantSku: { fontSize: 12, marginTop: 4 },
  variantMeta: { alignItems: "flex-end", gap: 4 },
  variantPrice: { fontSize: 15, fontWeight: "800" },
  variantAvailability: { fontSize: 11, fontWeight: "800" },
  notice: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginTop: 18,
  },
  noticeTitle: { fontSize: 14, fontWeight: "800" },
  noticeText: { fontSize: 13, lineHeight: 19, marginTop: 5 },
  cartLines: { marginTop: 20, gap: 10 },
  cartLine: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 14,
  },
  cartLineTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  quantityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  quantityButton: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  quantityText: { fontSize: 22, fontWeight: "700" },
  quantityValue: {
    minWidth: 30,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "800",
  },
  stockInline: { fontSize: 12, marginLeft: 4, flex: 1 },
  summary: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    marginTop: 18,
  },
  summaryLabel: { fontSize: 12, fontWeight: "700" },
  summaryValue: { fontSize: 26, fontWeight: "800", marginTop: 5 },
  summaryFoot: { fontSize: 12, lineHeight: 18, marginTop: 7 },
  formSection: { marginTop: 26, gap: 12 },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 16,
  },
  errorText: { fontSize: 13, lineHeight: 19, fontWeight: "700" },
  legalNote: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 13,
    paddingHorizontal: 8,
  },
  successCard: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 24,
  },
  successTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "900",
    marginTop: 7,
  },
});
