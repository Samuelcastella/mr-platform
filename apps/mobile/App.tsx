import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
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

const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  "https://catalog-api-production-cc18.up.railway.app";

const STOREFRONT_URL =
  process.env.EXPO_PUBLIC_STOREFRONT_URL ??
  "https://storefront-production-e7b5.up.railway.app/";

function money(value: string | number, currency = "HNL") {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("es-HN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export default function App() {
  const scheme = useColorScheme();
  const dark = scheme === "dark";
  const theme = useMemo(
    () => ({
      background: dark ? "#111111" : "#F7F2EA",
      surface: dark ? "#1B1B1B" : "#FFFFFF",
      text: dark ? "#F7F2EA" : "#171717",
      muted: dark ? "#BDB4A7" : "#6E665E",
      border: dark ? "#34302B" : "#E3D9CC",
      accent: "#B58A3A",
    }),
    [dark],
  );

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE.replace(/\/$/, "")}/v1/products?status=active`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = (await response.json()) as { data?: Product[] };
      setProducts(Array.isArray(payload.data) ? payload.data : []);
    } catch {
      setError("No se pudo cargar el catálogo. Intenta nuevamente.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <StatusBar
        barStyle={dark ? "light-content" : "dark-content"}
        backgroundColor={theme.background}
      />

      <View style={styles.header}>
        <Image source={require("./assets/icon.png")} style={styles.logo} />
        <View style={styles.headerCopy}>
          <Text style={[styles.brand, { color: theme.text }]}>MR עדולם</Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>
            Catálogo móvil
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir tienda web"
          onPress={() => void Linking.openURL(STOREFRONT_URL)}
          style={({ pressed }) => [
            styles.webButton,
            { borderColor: theme.border, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.webButtonText, { color: theme.text }]}>Web</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={[styles.stateText, { color: theme.muted }]}>
            Cargando catálogo…
          </Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.stateTitle, { color: theme.text }]}>
            Catálogo no disponible
          </Text>
          <Text style={[styles.stateText, { color: theme.muted }]}>{error}</Text>
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
                Productos disponibles
              </Text>
              <Text style={[styles.body, { color: theme.muted }]}>
                Inventario y precios provienen del Commerce Core. Esta primera
                versión móvil es de consulta y enlaza la compra al storefront.
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.center}>
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
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
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
                    ? `${item.stock} unidad(es) disponibles · ${availableVariants.length} variante(s)`
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
                          {[variant.color, variant.size].filter(Boolean).join(" · ") ||
                            variant.sku}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
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
  webButton: {
    minHeight: 42,
    minWidth: 58,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  webButtonText: { fontSize: 14, fontWeight: "700" },
  list: { padding: 20, paddingTop: 6, paddingBottom: 40, gap: 12 },
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: "600" },
  center: {
    flex: 1,
    padding: 28,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  stateTitle: { fontSize: 22, fontWeight: "800", textAlign: "center" },
  stateText: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  primaryButton: {
    minHeight: 46,
    paddingHorizontal: 20,
    borderRadius: 999,
    justifyContent: "center",
  },
  primaryButtonText: { fontWeight: "800" },
});
