// Sunucu (API) adresi.
// - Web'de (siteyi sunan sunucu) boş = göreli yol (aynı origin).
// - Mobil (Capacitor/APK) içinde otomatik olarak canlı sunucuya bağlanır;
//   kullanıcı hiçbir adres yazmak zorunda kalmaz.
// İstenirse uygulama içi ⚙️ Ayarlar'dan (eviko_api_base) yine değiştirilebilir.
(function () {
  var isNative = !!(window.Capacitor || (location.protocol || "").indexOf("capacitor") === 0);
  window.EVIKO_API_BASE = isNative ? "https://eviko.onrender.com" : "";
})();
