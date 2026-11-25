// Memasang asisten di dalam halaman. Dimuat dengan:
//   <script type="module" src="site.js"></script>
// Halaman butuh markup mount dari assistant-section.html.
import { App } from "./script.js";

/**
 * Menyalakan runtime browser di section asisten halaman.
 *
 * Runtime diarahkan ke folder ini, supaya manifest, network dan actions dimuat
 * dari tempat yang sama dengan halaman. Sebelum tiap action irreversible,
 * runtime menampilkan dialog konfirmasi sendiri, yang ditulis untuk pengunjung.
 */
export class AssistantMount {
  /**
   * Pesan chat pertama setelah pengunjung punya key: apa yang bisa dilakukan asisten di sini.
   */
  static GREETING = "Halo! Saya bisa bantu cari harga dan stok barang, mengisi keranjang, dan membuat pesanan demo — ambil sendiri atau diantar. Tanya saja, misalnya “cabe rawit sekilo berapa?”";

  /**
   * Kata-kata dialog konfirmasi untuk tiap action irreversible. Nama tiap tombol
   * sesuai dengan yang dilakukannya, supaya "Batal" tidak punya dua arti.
   */
  static DIALOGS = {
    "checkout_demo_order": {
      title: "Buat pesanan demo ini?",
      sentence: "Pesanan demo akan dibuat dan keranjang dikosongkan. Tidak ada pembayaran dan tidak ada barang yang benar-benar dikirim.",
      confirm: "Buat pesanan demo",
      decline: "Jangan dulu",
    },
  };

  /**
   * Nyalakan runtime dan laporkan hasilnya di baris status.
   *
   * :return: Engine runtime, atau null saat boot gagal.
   */
  static async start() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
      // Muat runtime di sini, supaya runtime yang hilang atau rusak ikut dilaporkan.
      const { boot } = await import("./runtime/index.js");
      const booted = await boot("#agent-app", {
        originUrl: siteBase,
        sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
      });
      AssistantMount.engine = booted.engine;
      AssistantMount.defaultReview = booted.engine.onActionConfirm;
      booted.engine.onActionConfirm = AssistantMount.review;
      AssistantMount.defaultConsent = booted.engine.onConsent;
      booted.engine.onConsent = AssistantMount.consent;
      // Tanpa key, chat belum bisa menjawab. Ini tes yang sama dengan lencana
      // "API key required" di runtime/ui.js.
      const needsKey = !booted.engine.mockLLM
        && (!booted.engine.byokKey || booted.engine.byokKey === "demo");
      status.textContent = needsKey
        ? "Asisten butuh key penyedia AI Anda. Tambahkan di pengaturan model AI di bawah."
        : "Asisten terhubung ke halaman ini.";
      if (!needsKey) {
        AssistantMount.greet();
      }
      return booted.engine;
    } catch (error) {
      // Halaman harus tetap bisa dipakai tanpa asisten.
      status.textContent = "Asisten gagal dimuat. Anda tetap bisa memakai halaman ini langsung.";
      console.error("Assistant startup failed", error);
      return null;
    }
  }

  /**
   * Ganti pesan chat pertama bawaan runtime dengan GREETING. "New chat" memakai
   * pesan pertama yang sama, jadi sapaan bertahan selama kunjungan.
   */
  static greet() {
    const first = document.querySelector("#ns-msgs .ns-msg.bot");
    if (first) {
      first.textContent = AssistantMount.GREETING;
    }
  }

  /**
   * Minta pengunjung mengonfirmasi action sebelum berjalan. Action halaman ini
   * yang ada di DIALOGS mendapat dialog halaman ini. Yang lain, seperti action
   * situs partner, mendapat dialog runtime sendiri.
   *
   * :param items: Action yang menunggu konfirmasi, masing-masing dengan action,
   *   origin, effect dan arguments.
   * :return: True bila pengunjung mengonfirmasi.
   * :raises Error: Alasan situs, saat cek situs menolak action, atau saat form
   *   chat menggabungkan salah satu action DIALOGS halaman ini dengan action lain.
   */
  static async review(items) {
    let confirmed = false;
    const pageOrigin = new URL(document.URL).origin;
    // Dialog halaman ini menampilkan satu action dengan detailnya dan menjalankan
    // cek situs sendiri. Form chat yang menggabungkan action itu dengan yang lain
    // akan melewati keduanya, jadi tidak ada yang berjalan.
    if (items.length > 1) {
      for (const item of items) {
        if (item.origin === pageOrigin && Object.hasOwn(AssistantMount.DIALOGS, item.action)) {
          throw new Error(`Nothing ran. "${AssistantMount.DIALOGS[item.action].confirm}" needs its own confirmation, so ask the assistant to do that on its own.`);
        }
      }
    }
    // Action partner bisa bernama sama dengan action halaman ini. Action itu
    // mendapat dialog runtime, yang menyebut origin partner, dan cek halaman ini
    // tidak pernah berjalan.
    const own = items.length === 1 && items[0].origin === pageOrigin;
    if (own && Object.hasOwn(AssistantMount.DIALOGS, items[0].action)) {
      const content = AssistantMount.dialogContent(items[0]);
      if (content.refusal) {
        // Dialog akan menawarkan tombol yang tidak bisa bekerja. Runtime tidak
        // menjalankan apa-apa dan memberi agen alasan ini sebagai pesan
        // "Error from tool".
        throw new Error(content.refusal);
      }
      confirmed = await new Promise(AssistantMount.openDialog.bind(null, content));
    } else {
      confirmed = await AssistantMount.defaultReview(items);
    }
    AssistantMount.keepFocusInChat();
    return confirmed;
  }

  /**
   * Minta pengunjung, lewat kartu consent runtime, apakah boleh menghubungi
   * situs partner. Fokuskan kartu selagi menunggu, lalu kembalikan fokus ke chat.
   *
   * :param info: Apa yang ditampilkan kartu, seperti label dan host partner
   *   serta permintaannya.
   * :return: Jawaban kartu, apa adanya: "allow", "always" atau "decline".
   *   Runtime mengizinkan panggilan bila ini mengembalikan nothing.
   */
  static async consent(info) {
    // defaultConsent() menambahkan kartu sekaligus. Kartu tidak punya role, dan
    // stylesheet menyembunyikan baris status selagi menunggu, jadi beri nama kartu
    // dan fokuskan judulnya.
    const answer = AssistantMount.defaultConsent(info);
    AssistantMount.focusConsentCard();
    const decision = await answer;
    // Menjawab kartu menghapus tombolnya, jadi fokus bisa jatuh ke body halaman.
    AssistantMount.keepFocusInChat();
    return decision;
  }

  /**
   * Beri nama pada kartu consent terbaru sesuai judulnya, untuk pembaca layar.
   * Pindahkan fokus ke judul itu saat fokus ada di chat atau di body halaman,
   * bukan dari form halaman sendiri.
   */
  static focusConsentCard() {
    const cards = document.querySelectorAll("#ns-msgs .ns-consent");
    const card = cards[cards.length - 1];
    const title = card ? card.querySelector(".ns-consent-title") : null;
    if (!title) {
      return;
    }
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", title.textContent);
    // Pengunjung yang sedang mengetik di form halaman sendiri tetap fokus, dan
    // ketikannya tetap terjaga.
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest("#agent-app")) {
      return;
    }
    // tabIndex -1 membuat judul bisa difokuskan. Enter tidak bisa mengaktifkan
    // judul, jadi Enter yang tidak sengaja tidak menjawab apa-apa.
    title.tabIndex = -1;
    title.focus();
  }

  /**
   * Tentukan isi dialog untuk satu action: kata-katanya dari DIALOGS, detail yang
   * bisa dibaca, dan panggilan persisnya. Ini data biasa, supaya tes bisa memeriksanya.
   *
   * :param item: Action yang menunggu konfirmasi, dengan action, origin, effect
   *   dan arguments.
   * :return: Judul, kalimat, label tombol, detail, teks panggilan persis, dan
   *   penolakan situs, bila ada.
   */
  static dialogContent(item) {
    let details = {};
    try {
      details = AssistantMount.reviewDetails(item.action, item.arguments) || {};
    } catch (error) {
      // Dialog lalu membuka panggilan persisnya, dan pengunjung yang memutuskan.
      console.error("Could not add details to the confirmation dialog", error);
    }
    return {
      ...AssistantMount.DIALOGS[item.action],
      details: details,
      refusal: details.refusal,
      exact: `${item.action} on ${item.origin} (${item.effect})\n${JSON.stringify(item.arguments, null, 2)}`,
    };
  }

  /**
   * Beri detail yang bisa dibaca untuk satu action irreversible, seperti barang,
   * total, nama, dan biaya pembatalan, dari operasi read-only halaman sendiri,
   * supaya tidak ada aturan yang disalin ke sini. Saat cek operasi menolak
   * panggilan, kembalikan {refusal: reason}, dan review() tidak membuka dialog.
   *
   * :param action: Nama action.
   * :param args: Argumen action.
   * :return: Detail per label, {refusal: reason}, atau {} bila action tidak punya detail.
   */
  static reviewDetails(action, args) {
    if (action === "checkout_demo_order") {
      const check = App.page.checkCheckout({
        nama: args.customerName,
        cara: args.cara,
        alamat: args.address,
        jam: args.jam,
        cartVersion: args.expectedCartVersion,
      });
      if (!check.ok) {
        return { refusal: check.reason };
      }
      const barang = check.items.map(function (row) {
        return row.qty + " × " + row.nama + " — Rp" + row.subtotal.toLocaleString("id-ID");
      }).join(", ");
      const terima = check.cara === "antar"
        ? "Diantar ke " + check.alamat + ", jam " + check.jam
        : "Ambil sendiri di pasar, jam " + check.jam;
      return {
        "Barang": barang,
        "Total": "Rp" + check.total.toLocaleString("id-ID"),
        "Nama": check.nama,
        "Cara terima": terima,
        "Catatan": "Pesanan demo: tidak ada pembayaran dan tidak ada barang yang benar-benar dikirim.",
      };
    }
    return {};
  }

  /**
   * Buka dialog konfirmasi: pertanyaan, satu kalimat biasa, detail yang bisa
   * dibaca, panggilan persis di bawah "Technical details", dan dua tombol.
   *
   * :param content: Isi dialog, dari dialogContent().
   * :param resolve: Menerima true saat pengunjung mengonfirmasi, false bila tidak.
   */
  static openDialog(content, resolve) {
    const dialog = document.createElement("dialog");
    dialog.className = "assistant-review";
    dialog.setAttribute("aria-labelledby", "assistant-review-title");
    const heading = document.createElement("h2");
    heading.id = "assistant-review-title";
    heading.textContent = content.title;
    // Mulai dari heading, yang tidak bisa diaktifkan Enter, supaya Enter yang
    // tidak sengaja tidak mengonfirmasi apa-apa.
    heading.tabIndex = -1;
    heading.autofocus = true;
    const sentence = document.createElement("p");
    sentence.textContent = content.sentence;
    dialog.append(heading, sentence);
    const exact = document.createElement("details");
    const exactLabel = document.createElement("summary");
    exactLabel.textContent = "Technical details";
    const exactText = document.createElement("pre");
    exactText.textContent = content.exact;
    exact.append(exactLabel, exactText);
    const entries = Object.entries(content.details);
    if (entries.length) {
      const list = document.createElement("dl");
      for (const [label, value] of entries) {
        const term = document.createElement("dt");
        term.textContent = label;
        const description = document.createElement("dd");
        description.textContent = String(value);
        list.append(term, description);
      }
      dialog.append(list);
    } else {
      // Tanpa detail yang bisa dibaca, buka panggilan persisnya, supaya
      // pengunjung tetap melihatnya.
      exact.open = true;
    }
    const confirmButton = document.createElement("button");
    confirmButton.textContent = content.confirm;
    confirmButton.addEventListener("click", dialog.close.bind(dialog, "confirm"));
    const declineButton = document.createElement("button");
    declineButton.className = "assistant-decline";
    declineButton.textContent = content.decline;
    declineButton.addEventListener("click", dialog.close.bind(dialog, "decline"));
    // Escape juga menutup dialog, tanpa "confirm".
    dialog.addEventListener("close", AssistantMount.finishDialog.bind(null, dialog, resolve));
    dialog.append(exact, confirmButton, declineButton);
    document.body.append(dialog);
    dialog.showModal();
  }

  /**
   * Hapus dialog yang sudah ditutup dan laporkan pilihan pengunjung.
   *
   * :param dialog: Dialog yang ditutup.
   * :param resolve: Menerima true saat pengunjung menekan tombol konfirmasi.
   */
  static finishDialog(dialog, resolve) {
    dialog.remove();
    resolve(dialog.returnValue === "confirm");
  }

  /**
   * Kembalikan fokus ke input chat saat dialog atau kartu consent
   * meninggalkannya di body halaman. Form chat menonaktifkan kontrolnya saat
   * dikirim, jadi fokus bisa jatuh ke body, dan Tab berikutnya akan mulai dari
   * atas halaman.
   */
  static keepFocusInChat() {
    if (document.activeElement === document.body || document.activeElement === null) {
      document.querySelector("#ns-input")?.focus();
    }
  }
}

// Boot hanya di browser. Tes Node mengimpor file ini untuk memeriksa kata-kata dialog.
if (typeof window !== "undefined") {
  await AssistantMount.start();
}
