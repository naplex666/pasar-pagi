// Pasar Pagi Cilacap — situs statis demo, tanpa backend dan tanpa pembayaran.
// Data barang dimuat dari data/harga.json lewat JSON import, supaya katalog
// tersedia sinkron saat modul dimuat (di browser maupun di tes Node).
// Keranjang dan riwayat pesanan demo hanya tersimpan di localStorage perangkat
// pengunjung.
//
// Objek `App.page` adalah antarmuka yang dipakai agen (site actions). Semua
// metodenya mengembalikan { ok: true, ... } atau { ok: false, reason: "..." }
// dan TIDAK PERNAH melempar error untuk input yang buruk.

import hargaData from "./data/harga.json" with { type: "json" };

var CART_KEY = "pasar-pagi-cart-v1";
var ORDERS_KEY = "pasar-pagi-orders-v1";
var MAX_ORDERS = 5;

var items = hargaData.barang || [];      // barang dari data/harga.json
var categories = hargaData.kategori || [];
var tanggalHarga = hargaData.tanggal_harga || null;
var cart = new Map();    // id -> jumlah
var cartVersion = 0;     // naik setiap kali isi keranjang berubah
var orders = [];         // pesanan demo terakhir (localStorage)
var activeCategory = "Semua";
var searchText = "";

// ---------- util ----------

function rupiah(n) {
  return "Rp" + Number(n).toLocaleString("id-ID");
}

function findItem(id) {
  for (var i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i];
  }
  return null;
}

function cartEntries() {
  var out = [];
  cart.forEach(function (qty, id) {
    var item = findItem(id);
    if (item) out.push({ id: id, nama: item.nama, harga: item.harga, satuan: item.satuan, qty: qty, subtotal: item.harga * qty });
  });
  return out;
}

function cartTotal() {
  var total = 0;
  cart.forEach(function (qty, id) {
    var item = findItem(id);
    if (item) total += item.harga * qty;
  });
  return total;
}

function saveCart() {
  try {
    var obj = {};
    cart.forEach(function (qty, id) { obj[id] = qty; });
    localStorage.setItem(CART_KEY, JSON.stringify(obj));
  } catch (e) { /* penyimpanan lokal tidak tersedia: keranjang tetap jalan di memori */ }
}

function loadCart() {
  try {
    var raw = localStorage.getItem(CART_KEY);
    if (!raw) return;
    var obj = JSON.parse(raw);
    Object.keys(obj).forEach(function (id) {
      var qty = Number(obj[id]);
      if (findItem(id) && Number.isInteger(qty) && qty > 0) cart.set(id, qty);
    });
  } catch (e) { /* abaikan data keranjang yang rusak */ }
}

function loadOrders() {
  try {
    var raw = localStorage.getItem(ORDERS_KEY);
    if (raw) orders = JSON.parse(raw) || [];
  } catch (e) { orders = []; }
}

function saveOrders() {
  try { localStorage.setItem(ORDERS_KEY, JSON.stringify(orders.slice(0, MAX_ORDERS))); }
  catch (e) { /* abaikan */ }
}

function orderNumber() {
  var d = new Date();
  var ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  var acak = Math.random().toString(36).slice(2, 6).toUpperCase();
  return "PP-" + ymd + "-" + acak;
}

function el(tag, text, className) {
  var node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function pageText(id) {
  var node = document.querySelector("#" + id);
  return node ? node.textContent.trim() : "";
}

function hariIni() {
  var d = new Date();
  var iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  var hari = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][d.getDay()];
  return hari + ", " + iso;
}

// ---------- antarmuka publik (dipakai agen sebagai site actions) ----------

function getState() {
  return {
    ok: true,
    pasar: "Pasar Pagi Cilacap",
    hariIni: hariIni(),
    tanggalHarga: tanggalHarga,
    catatanHarga: "Harga contoh untuk demo.",
    jamBuka: pageText("jam-buka"),
    catatanDemo: pageText("catatan-demo"),
    items: items.map(function (it) {
      return { id: it.id, nama: it.nama, lapak: it.lapak, kategori: it.kategori, harga: it.harga, satuan: it.satuan, stok: it.stok, keterangan: it.keterangan };
    }),
    cart: cartEntries(),
    cartTotal: cartTotal(),
    cartVersion: cartVersion,
    latestOrder: orders.length ? orders[0] : null
  };
}

function addToCart(id, qty) {
  try {
    var item = findItem(id);
    if (!item) return { ok: false, reason: "Barang tidak ditemukan: " + String(id) };
    var jumlah = qty === undefined ? 1 : Number(qty);
    if (!Number.isInteger(jumlah) || jumlah <= 0) {
      return { ok: false, reason: "Jumlah harus bilangan bulat lebih dari 0." };
    }
    var sekarang = cart.get(id) || 0;
    var baru = sekarang + jumlah;
    if (baru > item.stok) {
      return { ok: false, reason: item.nama + " hanya tersisa " + item.stok + " " + item.satuan + "." };
    }
    cart.set(id, baru);
    cartVersion += 1;
    saveCart();
    renderCart();
    return { ok: true, id: id, qty: baru, cart: cartEntries(), cartTotal: cartTotal(), cartVersion: cartVersion };
  } catch (e) {
    return { ok: false, reason: "Gagal menambah keranjang." };
  }
}

function setCart(list) {
  try {
    if (!Array.isArray(list)) return { ok: false, reason: "Keranjang harus berupa daftar barang." };
    var next = new Map();
    for (var i = 0; i < list.length; i++) {
      var row = list[i] || {};
      var item = findItem(row.id);
      if (!item) return { ok: false, reason: "Barang tidak ditemukan: " + String(row.id) };
      var qty = Number(row.qty);
      if (!Number.isInteger(qty) || qty < 0) {
        return { ok: false, reason: "Jumlah " + item.nama + " harus bilangan bulat 0 atau lebih." };
      }
      if (qty > item.stok) {
        return { ok: false, reason: item.nama + " hanya tersisa " + item.stok + " " + item.satuan + "." };
      }
      if (qty > 0) next.set(row.id, qty);
    }
    cart = next;
    cartVersion += 1;
    saveCart();
    renderCart();
    return { ok: true, cart: cartEntries(), cartTotal: cartTotal(), cartVersion: cartVersion };
  } catch (e) {
    return { ok: false, reason: "Gagal mengatur keranjang." };
  }
}

// Cek read-only untuk checkout: semua aturan checkout, tanpa mengubah apa pun.
// Dipakai checkout() sendiri dan dialog konfirmasi di site.js.
function checkCheckout(data) {
  data = data || {};
  if (cart.size === 0) return { ok: false, reason: "Keranjang masih kosong." };
  var nama = String(data.nama || "").trim();
  if (!nama) return { ok: false, reason: "Nama wajib diisi." };
  var cara = data.cara === "antar" ? "antar" : (data.cara === "ambil" ? "ambil" : null);
  if (!cara) return { ok: false, reason: "Cara terima harus 'ambil' atau 'antar'." };
  var alamat = String(data.alamat || "").trim();
  if (cara === "antar" && !alamat) {
    return { ok: false, reason: "Alamat antar wajib diisi untuk pengiriman." };
  }
  var jam = String(data.jam || "");
  var jamValid = ["06:00", "07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
  if (jamValid.indexOf(jam) === -1) return { ok: false, reason: "Jam tidak valid." };
  if (data.cartVersion !== undefined && Number(data.cartVersion) !== cartVersion) {
    return { ok: false, reason: "Keranjang berubah sejak disiapkan. Periksa kembali isi keranjang." };
  }
  return {
    ok: true,
    nama: nama,
    cara: cara,
    alamat: cara === "antar" ? alamat : null,
    jam: jam,
    items: cartEntries(),
    total: cartTotal()
  };
}

// data: { nama, cara: "ambil"|"antar", alamat?, jam, cartVersion? }
// Bila cartVersion disertakan dan tidak cocok dengan versi keranjang
// saat ini, checkout ditolak — keranjang berubah sejak disiapkan.
function checkout(data) {
  try {
    var check = checkCheckout(data);
    if (!check.ok) return check;
    var isi = check.items;
    var total = check.total;
    var order = {
      id: orderNumber(),
      status: "Diterima (demo)",
      nama: check.nama,
      cara: check.cara,
      alamat: check.alamat,
      jam: check.jam,
      items: isi,
      total: total,
      waktu: new Date().toISOString()
    };
    // Kurangi stok di memori (demo; data harga.json tidak diubah).
    isi.forEach(function (row) {
      var item = findItem(row.id);
      if (item) item.stok = Math.max(0, item.stok - row.qty);
    });
    orders.unshift(order);
    orders = orders.slice(0, MAX_ORDERS);
    saveOrders();
    cart.clear();
    cartVersion += 1;
    saveCart();
    renderCart();
    renderOrders();
    return { ok: true, order: order };
  } catch (e) {
    return { ok: false, reason: "Gagal memproses pesanan demo." };
  }
}

export const App = {
  page: {
    getState: getState,
    getItem: function (id) { var it = findItem(id); return it ? { ok: true, item: it } : { ok: false, reason: "Barang tidak ditemukan: " + String(id) }; },
    listItems: function () { return { ok: true, items: getState().items }; },
    catalogIds: function () { return items.map(function (it) { return it.id; }); },
    addToCart: addToCart,
    setCart: setCart,
    checkCheckout: checkCheckout,
    checkout: checkout
  }
};

// Kompatibilitas: Fase 1 memakai window.PasarPagi.
if (typeof globalThis !== "undefined") globalThis.PasarPagi = App.page;

// ---------- tampilan ----------

function filteredItems() {
  var q = searchText.trim().toLowerCase();
  return items.filter(function (it) {
    var cocokKategori = activeCategory === "Semua" || it.kategori === activeCategory;
    var cocokCari = !q || it.nama.toLowerCase().indexOf(q) !== -1 ||
      it.lapak.toLowerCase().indexOf(q) !== -1 ||
      it.keterangan.toLowerCase().indexOf(q) !== -1;
    return cocokKategori && cocokCari;
  });
}

function renderCatalog() {
  var grid = document.querySelector("#katalog");
  var kosong = document.querySelector("#katalog-kosong");
  var info = document.querySelector("#hasil-info");
  grid.replaceChildren();
  var daftar = filteredItems();
  info.textContent = daftar.length + " barang ditampilkan" +
    (activeCategory !== "Semua" ? " · kategori " + activeCategory : "") +
    (searchText.trim() ? " · cari “" + searchText.trim() + "”" : "") + ".";
  kosong.hidden = daftar.length > 0;
  daftar.forEach(function (item) {
    var card = el("article", undefined, "barang");
    card.append(el("h3", item.nama));
    card.append(el("div", rupiah(item.harga) + " / " + item.satuan, "harga"));
    card.append(el("div", item.lapak + " · " + item.kategori, "lapak"));
    card.append(el("p", item.keterangan, "ket"));
    var stok = el("div", item.stok > 0 ? "Stok: " + item.stok + " " + item.satuan : "Stok habis",
      "stok" + (item.stok > 0 ? "" : " habis"));
    card.append(stok);
    var aksi = el("div", undefined, "aksi");
    var btn = el("button", "+ Keranjang");
    btn.type = "button";
    btn.disabled = item.stok === 0;
    btn.setAttribute("aria-label", "Tambah " + item.nama + " ke keranjang");
    btn.addEventListener("click", function () {
      var hasil = addToCart(item.id, 1);
      document.querySelector("#keranjang-status").textContent = hasil.ok
        ? item.nama + " masuk keranjang. Total " + rupiah(cartTotal()) + "."
        : hasil.reason;
    });
    aksi.append(btn);
    card.append(aksi);
    grid.append(card);
  });
}

function renderChips() {
  var wrap = document.querySelector("#filter-kategori");
  wrap.replaceChildren();
  ["Semua"].concat(categories).forEach(function (kat) {
    var btn = el("button", kat, "chip");
    btn.type = "button";
    btn.setAttribute("aria-pressed", kat === activeCategory ? "true" : "false");
    btn.addEventListener("click", function () {
      activeCategory = kat;
      renderChips();
      renderCatalog();
    });
    wrap.append(btn);
  });
}

function renderCart() {
  var list = document.querySelector("#keranjang-items");
  var kosong = document.querySelector("#keranjang-kosong");
  list.replaceChildren();
  var isi = cartEntries();
  kosong.hidden = isi.length > 0;
  isi.forEach(function (row) {
    var li = el("li");
    var baris = el("div", undefined, "baris-keranjang");
    baris.append(el("strong", row.nama + " × " + row.qty + " " + row.satuan));
    baris.append(el("span", rupiah(row.subtotal)));
    var kontrol = el("div", undefined, "kontrol-jumlah");
    var kurang = el("button", "−");
    kurang.type = "button";
    kurang.setAttribute("aria-label", "Kurangi " + row.nama);
    kurang.onclick = function () {
      var next = cartEntries().map(function (r) {
        return { id: r.id, qty: r.id === row.id ? r.qty - 1 : r.qty };
      }).filter(function (r) { return r.qty > 0; });
      setCart(next);
    };
    var tambah = el("button", "+");
    tambah.type = "button";
    tambah.setAttribute("aria-label", "Tambah " + row.nama);
    tambah.onclick = function () { addToCart(row.id, 1); };
    var hapus = el("button", "Hapus", "hapus");
    hapus.type = "button";
    hapus.setAttribute("aria-label", "Hapus " + row.nama + " dari keranjang");
    hapus.onclick = function () {
      setCart(cartEntries().filter(function (r) { return r.id !== row.id; }).map(function (r) { return { id: r.id, qty: r.qty }; }));
    };
    kontrol.append(kurang, el("span", String(row.qty)), tambah, hapus);
    li.append(baris, kontrol);
    list.append(li);
  });
  document.querySelector("#keranjang-total").textContent = rupiah(cartTotal());
  document.querySelector("#pesan-btn").disabled = isi.length === 0;
}

function renderOrders() {
  var list = document.querySelector("#riwayat-items");
  var kosong = document.querySelector("#riwayat-kosong");
  list.replaceChildren();
  kosong.hidden = orders.length > 0;
  orders.forEach(function (o) {
    var li = el("li");
    li.append(el("strong", o.id + " — " + o.status));
    li.append(el("div", o.items.map(function (r) { return r.qty + " × " + r.nama; }).join(", ")));
    li.append(el("div", (o.cara === "antar" ? "Diantar" : "Ambil sendiri") + " · " + o.jam + " · " + rupiah(o.total), "muted"));
    list.append(li);
  });
}

function showConfirmation(order) {
  document.querySelector("#konfirmasi-ringkasan").textContent =
    order.nama + ", pesanan " + order.id + " " + order.status.toLowerCase() + ". " +
    (order.cara === "antar"
      ? "Diantar ke " + order.alamat + ", jam " + order.jam + "."
      : "Ambil sendiri di pasar, jam " + order.jam + ".");
  var list = document.querySelector("#konfirmasi-items");
  list.replaceChildren();
  order.items.forEach(function (r) {
    list.append(el("li", r.qty + " × " + r.nama + " — " + rupiah(r.subtotal)));
  });
  document.querySelector("#konfirmasi-total").textContent = rupiah(order.total);
  var box = document.querySelector("#konfirmasi");
  box.hidden = false;
  box.focus();
}

// ---------- pasang event + render awal ----------

function init() {
  var form = document.querySelector("#checkout-form");
  var cara = document.querySelector("#cara");
  var alamatWrap = document.querySelector("#alamat-wrap");
  var alamat = document.querySelector("#alamat");

  cara.addEventListener("change", function () {
    var antar = cara.value === "antar";
    alamatWrap.hidden = !antar;
    alamat.required = antar;
  });
  document.querySelector("#cari").addEventListener("input", function (e) {
    searchText = e.target.value;
    renderCatalog();
  });
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var hasil = checkout({
      nama: document.querySelector("#nama").value,
      cara: cara.value,
      alamat: alamat.value,
      jam: document.querySelector("#jam").value,
      cartVersion: cartVersion
    });
    if (!hasil.ok) {
      document.querySelector("#keranjang-status").textContent = hasil.reason;
      return;
    }
    form.reset();
    alamatWrap.hidden = true;
    showConfirmation(hasil.order);
    renderCatalog();
  });

  document.querySelector("#harga-info").textContent =
    "Harga tanggal " + (tanggalHarga || "-") + ". " + (hargaData.catatan || "");
  loadCart();
  loadOrders();
  renderChips();
  renderCatalog();
  renderCart();
  renderOrders();
}

if (typeof document !== "undefined") init();
