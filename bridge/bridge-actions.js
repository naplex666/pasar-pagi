// Action yang dibagikan situs ini ke situs agen lain, lewat action bridge.
// Build menyebut file ini di bridge/agent-manifest.json. Saat asisten situs lain
// memanggil network situs ini, bridge memuat file ini di frame tersembunyi di
// origin situs ini, yang tidak punya halaman. Hanya nama di
// "actions.agentTools" manifest yang sampai ke agen partner.
//
// Bridge ini hanya membagikan read get_market_state: katalog dan fakta halaman
// yang sudah publik. Tidak ada keranjang, pesanan, atau data pengunjung.

/**
 * Membagikan read situs ini ke situs partner yang memanggil network-nya.
 *
 * Agen partner memanggilnya dari halaman partner. Tiap read berjalan di sini,
 * di frame tersembunyi di origin situs ini, dengan kode situs sendiri. Tidak
 * ada yang bisa melihat halaman atau apa yang dilakukan satu pengunjung di
 * sana, seperti keranjang.
 */
class BridgeActions {
  /**
   * Situs yang boleh memanggil read ini, sebagai origin persis beserta port.
   * "*" membagikan read ke semua situs di web: dipakai hanya untuk fakta yang
   * sudah ditampilkan halaman publik, seperti harga dan jam buka.
   */
  static CALLERS = ["*"];

  /**
   * Data situs, untuk fakta yang hanya ada di HTML halaman.
   */
  static PAGE = new URL("../index.html", import.meta.url).href;

  /**
   * Daftarkan read yang dibagikan.
   *
   * :param actions: Fasade registry runtime dengan metode register(definition).
   */
  static registerActions(actions) {
    actions.register(BridgeActions.readStateAction());
  }

  /**
   * Deskripsikan read katalog dan fakta halaman yang dibagikan.
   *
   * :return: Definisi action.
   */
  static readStateAction() {
    return {
      // Action halaman sendiri punya nama dan input yang sama, supaya instruksi
      // network cocok untuk keduanya.
      name: "get_market_state",
      description: "Baca katalog Pasar Pagi Cilacap: 24 barang dengan harga, lapak, kategori dan stok, beserta jam buka dan catatan demo. Tidak ada keranjang atau pesanan: bridge tidak bisa melihat halaman pengunjung. Tidak mengubah apa-apa. Panggil sebelum menjawab tentang harga, stok atau barang.",
      effect: "read",
      availability: "bridge",
      callerOrigins: BridgeActions.CALLERS,
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: BridgeActions.readState,
    };
  }

  /**
   * Baca data situs dan fakta yang hanya ada di HTML halaman.
   *
   * :return: Promise berisi data dan fakta halaman.
   */
  static async readState() {
    const dataResponse = await fetch(new URL("../data/harga.json", import.meta.url));
    if (!dataResponse.ok) {
      throw new Error(`Data harga menjawab ${dataResponse.status}.`);
    }
    const data = await dataResponse.json();
    const page = await BridgeActions.readPage(BridgeActions.PAGE);
    return {
      ok: true,
      pasar: "Pasar Pagi Cilacap",
      tanggalHarga: data.tanggal_harga || null,
      catatanHarga: "Harga contoh untuk demo.",
      jamBuka: page.querySelector("#jam-buka")?.textContent.trim() || "",
      catatanDemo: page.querySelector("#catatan-demo")?.textContent.trim() || "",
      items: (data.barang || []).map(function (it) {
        return { id: it.id, nama: it.nama, lapak: it.lapak, kategori: it.kategori, harga: it.harga, satuan: it.satuan, stok: it.stok, keterangan: it.keterangan };
      }),
    };
  }

  /**
   * Ambil satu halaman situs dan parse, supaya faktanya bisa dibaca seperti di halaman.
   *
   * :param url: Alamat halaman.
   * :return: Promise berisi dokumen hasil parse, dengan link yang mengacu ke alamat halaman.
   * :raises Error: Saat tidak ada DOMParser, atau halaman tidak bisa dibaca.
   */
  static async readPage(url) {
    // Cek dulu: Node punya fetch tapi tidak punya DOMParser, jadi tes tidak
    // pernah mengirim request sungguhan.
    if (typeof DOMParser === "undefined") {
      throw new Error("Reading the site's page needs a browser.");
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`The site's page answered ${response.status}.`);
    }
    const page = new DOMParser().parseFromString(await response.text(), "text/html");
    // Halaman hasil parse mengacu link ke alamat frame ini. Elemen base membuat
    // link mengacu ke alamat halaman sendiri, seperti di halaman.
    const base = page.createElement("base");
    base.href = url;
    page.head.prepend(base);
    return page;
  }
}

// Bridge memanggil ekspor registerActions modul ini.
export const registerActions = BridgeActions.registerActions;
