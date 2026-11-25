// Mendaftarkan operasi situs ini ke runtime agen.
// agent-manifest.json memuat modul ini lewat "actions.module". Hanya nama di
// "actions.agentTools" yang menjadi tool model, bernama website_<nama>.
//
// Setiap action membungkus fungsi yang sudah dipakai halaman sendiri, supaya
// asisten dan UI manual mengikuti satu aturan yang sama. Operasi mengembalikan
// {ok: false, reason, field} saat menolak input, sebelum mengubah apa pun, dan
// hanya melempar error untuk kegagalan tak terduga. Throw dilaporkan "unknown".
// Impor skrip halaman lewat URL yang sama dengan yang dimuat halaman (tanpa ?v=),
// supaya actions tidak mendapat salinan state halaman yang kedua.
import { App } from "./script.js";

/**
 * Mendeskripsikan operasi situs sebagai action yang bisa dipanggil agen.
 *
 * Runtime memvalidasi argumen terhadap inputSchema sebelum execute berjalan,
 * dan meminta pengunjung mengonfirmasi action "irreversible" lebih dulu.
 */
class SiteActions {
  /**
   * Daftarkan semua site action ke runtime.
   *
   * :param actions: Fasade registry runtime dengan metode register(definition).
   */
  static registerActions(actions) {
    actions.register(SiteActions.readStateAction());
    actions.register(SiteActions.addToCartAction());
    actions.register(SiteActions.setCartAction());
    actions.register(SiteActions.checkoutDemoOrderAction());
  }

  /**
   * Deskripsikan read action yang mengembalikan data dan state halaman.
   *
   * :return: Definisi action.
   */
  static readStateAction() {
    return {
      name: "get_market_state",
      // Model membaca tiap deskripsi untuk memilih tool. Tulis di sini kapan
      // memanggilnya dan apa yang harus dipanggil sebelumnya, bukan di instruksi agen.
      description: "Baca data pasar sebenarnya di halaman ini: katalog 24 barang dengan harga, lapak, kategori dan stok, keranjang beserta total dan cartVersion, pesanan demo terakhir, jam buka dan catatan demo. Panggil sebelum menjawab tentang harga, stok, barang, keranjang atau pesanan, dan panggil lagi di setiap giliran yang membutuhkannya: pengunjung juga bisa memakai halaman. Tidak mengubah apa-apa.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: SiteActions.readState,
    };
  }

  /**
   * Kembalikan salinan baru state halaman.
   *
   * :return: State halaman sebagai data JSON biasa.
   */
  static readState() {
    return App.page.getState();
  }

  /**
   * Deskripsikan write yang bisa dibatalkan dan boleh jalan tanpa dialog konfirmasi.
   *
   * :return: Definisi action.
   */
  static addToCartAction() {
    return {
      name: "add_to_cart",
      description: "Tambahkan sejumlah satu barang ke keranjang yang terlihat, dengan id dari website_get_market_state. Panggil hanya bila pengunjung meminta, dan jaga barang lain yang sudah ada di keranjang. Mengembalikan keranjang terbaru beserta total dan cartVersion baru, atau ok false dengan reason. Tidak membuat pesanan.",
      // "write" berjalan langsung. Pakai hanya untuk perubahan yang bisa
      // dibatalkan pengunjung di halaman.
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id", "quantity"],
        properties: {
          // Enum dari id asli membuat model tidak bisa mengarang barang.
          id: {
            type: "string",
            enum: App.page.catalogIds(),
            description: "Id barang dari website_get_market_state.",
          },
          quantity: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Jumlah yang ditambahkan, dalam satuan barang itu.",
          },
        },
      },
      execute: SiteActions.addToCart,
    };
  }

  /**
   * Tambah barang lewat fungsi keranjang situs sendiri.
   *
   * :param args: Argumen tervalidasi dengan id dan quantity.
   * :return: State halaman terbaru, yang menjadi struk tool.
   */
  static addToCart(args) {
    return App.page.addToCart(args.id, args.quantity);
  }

  /**
   * Deskripsikan write yang mengganti seluruh isi keranjang.
   *
   * :return: Definisi action.
   */
  static setCartAction() {
    return {
      name: "set_cart",
      description: "Ganti seluruh isi keranjang dengan daftar yang diinginkan, dengan id dari website_get_market_state. Sertakan barang yang mau dipertahankan. Daftar kosong mengosongkan keranjang. Panggil hanya bila pengunjung meminta. Mengembalikan keranjang terbaru beserta total dan cartVersion baru, atau ok false dengan reason. Tidak membuat pesanan.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["items"],
        properties: {
          items: {
            type: "array",
            maxItems: 24,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "quantity"],
              properties: {
                id: {
                  type: "string",
                  enum: App.page.catalogIds(),
                  description: "Id barang dari website_get_market_state.",
                },
                quantity: {
                  type: "integer",
                  minimum: 0,
                  maximum: 100,
                  description: "Jumlah yang diinginkan; 0 menghapus barang dari keranjang.",
                },
              },
            },
          },
        },
      },
      execute: SiteActions.setCart,
    };
  }

  /**
   * Ganti keranjang lewat fungsi situs sendiri.
   *
   * :param args: Argumen tervalidasi dengan items.
   * :return: State halaman terbaru, yang menjadi struk tool.
   */
  static setCart(args) {
    // Skema memakai "quantity"; fungsi halaman memakai "qty".
    return App.page.setCart(args.items.map(function (row) {
      return { id: row.id, qty: row.quantity };
    }));
  }

  /**
   * Deskripsikan operasi irreversible yang harus dikonfirmasi pengunjung.
   *
   * :return: Definisi action.
   */
  static checkoutDemoOrderAction() {
    return {
      name: "checkout_demo_order",
      description: "Buat pesanan demo untuk keranjang saat ini. Tanyakan dulu nama pengunjung, cara terima (ambil atau antar), alamat bila diantar, dan jam. Di giliran yang sama sebelum memanggil ini, panggil dulu website_get_market_state dan tunggu hasilnya: panggilan ini butuh cartVersion terbaru, dan hasil dari giliran sebelumnya tidak disimpan. Browser meminta pengunjung mengonfirmasi. Situs menolak expectedCartVersion yang basi. Mengembalikan struk pesanan demo; tidak ada pembayaran dan tidak ada barang yang benar-benar dikirim.",
      // "irreversible" membuat runtime membuka dialog konfirmasi sebelum execute berjalan.
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["customerName", "cara", "jam", "expectedCartVersion"],
        properties: {
          customerName: {
            type: "string",
            minLength: 1,
            maxLength: 80,
            description: "Nama yang diberikan pengunjung.",
          },
          cara: {
            type: "string",
            enum: ["ambil", "antar"],
            description: "Ambil sendiri di pasar, atau diantar ke alamat.",
          },
          address: {
            type: "string",
            maxLength: 300,
            description: "Alamat antar, wajib bila cara adalah antar.",
          },
          jam: {
            type: "string",
            minLength: 5,
            maxLength: 5,
            description: "Jam ambil atau antar hari ini dalam format JJ:MM, antara 06:00 dan 18:00. Situs memeriksa format dan jamnya.",
          },
          expectedCartVersion: {
            type: "integer",
            minimum: 0,
            description: "cartVersion terbaru di giliran ini: dari website_get_market_state, atau dari perubahan keranjang setelah pembacaan itu.",
          },
        },
      },
      execute: SiteActions.checkoutDemoOrder,
    };
  }

  /**
   * Pesan lewat fungsi yang sama dengan yang dipakai form halaman sendiri.
   *
   * :param args: Argumen tervalidasi yang sudah dikonfirmasi pengunjung.
   * :return: Struk pesanan, atau {ok: false, reason} saat situs menolak pesanan.
   */
  static checkoutDemoOrder(args) {
    return App.page.checkout({
      nama: args.customerName,
      cara: args.cara,
      alamat: args.address,
      jam: args.jam,
      cartVersion: args.expectedCartVersion,
    });
  }
}

// Runtime memanggil ekspor registerActions modul ini.
export const registerActions = SiteActions.registerActions;
