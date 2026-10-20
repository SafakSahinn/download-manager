# ⚡ Flux Download Manager (IDM Alternatifi)

Modern, şık arayüze sahip, IDM tarzı çoklu bağlantı (segment) mimarisiyle indirme yapabilen, YouTube vb. sitelerden video/ses indirebilen ve indirilen dosyaları uzantılarına göre otomatik klasörleyen masaüstü indirme yöneticisi.

---

## 🚀 Özellikler

1. **Akıllı Otomatik Klasörleme (Auto-Categorization)**:
   - **PDF**: `.pdf`
   - **Video**: `.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`, vb.
   - **Görsel**: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`, vb.
   - **Müzik**: `.mp3`, `.wav`, `.flac`, `.aac`, `.m4a`, vb.
   - **Arşiv**: `.zip`, `.rar`, `.7z`, `.tar`, `.gz`, `.iso`, vb.
   - **Program**: `.exe`, `.msi`, `.apk`, vb.
   - **Belge**: `.doc`, `.docx`, `.xls`, `.xlsx`, `.txt`, `.csv`, `.epub`, vb.
   - **Diğer**: Diğer tüm dosya formatları.
   *(Varsayılan ana klasör: `İndirilenler\DownloadManager\<Kategori>` - Ayarlardan değiştirilebilir)*

2. **Çoklu Bağlantılı (Segmented) Hızlandırma**:
   - Dosyaları dinamik parçalara bölerek eşzamanlı (paralel) indirme (IDM mantığı).
   - Canlı segment ilerleme çubuğu ile hangi bağlantının hangi parçayı indirdiği görsel olarak izlenebilir.

3. **Duraklat / Devam Ettir (Pause & Resume)**:
   - Destekleyen sunucularda indirmeleri dilediğiniz zaman duraklatıp kaldığı bayttan devam ettirebilirsiniz.

4. **Medya / Video İndirme**:
   - YouTube, Vimeo, Twitter/X, Instagram, TikTok ve 1000+ siteden tek tıkla video (1080p, 720p, vb.) veya doğrudan MP3 ses indirme.
   - Yerleşik `ffmpeg` ve otomatik güncellenen `yt-dlp` entegrasyonu.

5. **Pano (Clipboard) Algılama**:
   - Tarayıcınızda veya sistemde bir indirme linki kopyaladığınızda uygulama bunu anında algılar ve sağ altta tek tıkla indirme bildirimi sunar.

6. **Chrome & Edge Tarayıcı Eklentisi**:
   - `extension/` klasöründe hazır gelen Manifest V3 eklentisi.
   - Tarayıcıdaki indirmeleri yakalayarak doğrudan uygulamaya aktarır, sağ tık menüsüne *"Flux ile indir"* seçeneği ekler.

7. **Modern & Akıcı Arayüz**:
   - Windows 11 Fluent tasarım dili, Koyu / Açık / Sistem teması, Türkçe & İngilizce dil desteği, hız sınırlayıcı, arama ve filtreleme.

---

## 🛠️ Nasıl Çalıştırılır?

### Geliştirici Modunda Başlatma:
Terminalde proje klasöründeyken:
```bash
npm.cmd run dev
```
*(Vite arayüz sunucusu ve Electron aynı anda başlar)*

### Üretim (Production) Modunda Başlatma:
```bash
npm.cmd start
```

### Windows Kurulum Dosyası (EXE / Setup) Üretme:
```bash
npm.cmd run dist
```
*(Bu komut `release/` klasörü altına bağımsız bir Windows NSIS yükleyici oluşturur; `dist/` yalnızca derlenmiş arayüz içindir)*

### İlk Kurulum:
```bash
npm.cmd install
```

---

## 🌐 Tarayıcı Eklentisini (Chrome / Edge) Yükleme

1. Tarayıcınızda `chrome://extensions` veya `edge://extensions` adresine gidin.
2. Sağ üst köşeden **Geliştirici modu (Developer mode)** anahtarını açın.
3. **Paketlenmemiş öge yükle (Load unpacked)** butonuna tıklayın.
4. Bu projenin içindeki `extension` klasörünü seçin.
5. Artık tarayıcınızdan başlattığınız indirmeler ve sağ tıkladığınız linkler doğrudan Flux Download Manager'a yönlendirilecektir!
