# الدليل السريع لتشغيل النظام المحاسبي الموحد (UAS Enterprise ERP)
# UAS Enterprise ERP — Bilingual Quick-Start & USB Deployment Guide (AR / EN)

---

## 🇸🇦 أولاً: الدليل السريع باللغة العربية (Arabic Guide)

### 1. نسخ النظام من الفلاش ميموري (USB) إلى القرص الصلب للكمبيوتر
للحصول على أعلى سرعة أداء لقاعدة البيانات (SQLite) وتجنب بطء القراءة من الفلاش ميموري:
1. قم بتوصيل الفلاش ميموري (USB) بجهاز الكمبيوتر الرئيسي في المكتب.
2. انسخ مجلد **`UAS-USB-Package`** بالكامل والصقه في القرص المحلي **`C:\UAS-System`** (أو على سطح المكتب).
3. تأكد من وجود برنامج **Node.js (الإصدار 20 أو أحدث)** مثبتاً على جهاز الكمبيوتر الخادم فقط (لا تحتاج الهواتف أو أجهزة الموظفين الأخرى لأي برامج).

---

### 2. تشغيل النظام على الكمبيوتر والشبكة المحلية (Wi-Fi / LAN)
يوجد داخل المجلد ملفات تشغيل فورية بضغطة مزدوجة (Double-Click):

- **`Start-UAS-Office-LAN.bat`** *(أو `Start-UAS-Office-Server.bat` — الوضع الموصى به للمكاتب والفريق)*:
  - يقوم تلقائياً بتهيئة قاعدة بيانات نظيفة وجاهزة (`prisma/uas-enterprise.db`) في أول تشغيل.
  - يكتشف عنوان الشبكة المحلية للكمبيوتر تلقائياً (مثل: `http://192.168.1.100:3000`).
  - يفتح المنفذ `3000` في جدار حماية ويندوز (Windows Firewall) ليتمكن زملاؤك في المكتب من الدخول.
  - يفتح النظام تلقائياً في متصفحك على `http://localhost:3000` ويعرض على الشاشة السوداء الرابط المباشر لزملائك وهواتف الأندرويد.

- **`Start-UAS-Local.bat`** *(وضع الجهاز الواحد الفردي)*:
  - يشغل النظام محلياً على جهازك فقط عبر الرابط `http://localhost:3000`.

- **`Reset-Clean-Database.bat`** *(تصفير قاعدة البيانات للبداية الفعلية)*:
  - إذا قمت بإدخال حركات تجريبية للتدريب وأردت مسحها بالكامل والعودة إلى **نقطة الصفر (Clean Zero-State)** قبل بدء العمل المحاسبي الفعلي، شغل هذا الملف.
  - سيقوم بحذف كافة الفواتير والقيود والمشاريع التجريبية، مع الإبقاء على شجرة الحسابات القياسية (6 أجيال)، الصندوق الرئيسي برصيد `0.00`، وأسعار الصرف، والحسابات الوظيفية السبعة.

---

### 3. تثبيت تطبيق الجوال (`UAS-Mobile-App.apk`) على هواتف الأندرويد
1. افتح مجلد **`Android-Mobile`** داخل الحزمة.
2. انقل ملف **`UAS-Mobile-App.apk`** إلى هواتف الموظفين عبر وصلة USB (أو بلوتوث / واتساب / فلاش OTG).
3. افتح الملف على الهاتف واضغط **تثبيت (Install)** (اسمح بالتثبيت من هذا المصدر عند الطلب).
4. تأكد من اتصال الهاتف بنفس شبكة **Wi-Fi** المتصل بها كمبيوتر المكتب.
5. افتح تطبيق **UAS Accounting** على الهاتف:
   - في شاشة تسجيل الدخول، افتح خيار **"إعدادات الاتصال بخادم الشبكة المحلية / السحابة (LAN & Mobile APK)"**.
   - أدخل رابط الشبكة الظاهر في شاشة تشغيل الكمبيوتر (مثال: `http://192.168.1.100:3000`) أو الخادم السحابي (`https://qat.world`) واضغط **حفظ واتصال**.
   - يمكنك أيضاً فتح متصفح الهاتف (Chrome) والدخول مباشرة إلى `http://192.168.1.100:3000` وتثبيته كتطبيق ويب تقدمي (PWA).

---

### 4. بيانات الدخول الافتراضية (7 أدوار وظيفية — بدون أسماء شخصية)
تم تجهيز النظام بـ **7 حسابات وظيفية قياسية** (تظهر بالمسمى الوظيفي فقط حتى يقوم كل موظف بكتابة اسمه الشخصي في ملفه الشخصي):

| الدور الوظيفي (Role Title) | البريد الإلكتروني (Email) | اسم المستخدم (Username) | كلمة المرور الأولية | الصلاحيات الأساسية |
| :--- | :--- | :--- | :--- | :--- |
| **مدير النظام العام** (`SUPER_ADMIN`) | `admin@uas-ye.com` | `system_owner` | `123456` | صلاحية كاملة للنظام والمستخدمين والهوية والأستاذ العام |
| **مدير المشاريع** (`PROJECT_MANAGER`) | `pm@uas-ye.com` | `project_manager` | `123456` | إدارة المشاريع، القطاعات الفرعية، المواسم والقطفات |
| **رئيس الحسابات** (`CHIEF_ACCOUNTANT`) | `accountant@uas-ye.com` | `chief_accountant` | `123456` | شجرة الحسابات، دفتر اليومية، الخزينة، القوائم المالية، إقفال الفترات |
| **مسؤول المشتريات والمخازن** (`PROCUREMENT_OFFICER`) | `procurement@uas-ye.com` | `procurement_officer` | `123456` | الموردون، أوامر الشراء، استلام البضاعة، فواتير المشتريات، المخزون |
| **مسؤول المبيعات والتحصيل** (`SALES_COLLECTOR`) | `sales@uas-ye.com` | `sales_collector` | `123456` | مبيعات القطفات، الفواتير، العملاء، وسندات القبض |
| **محاسب ميداني** (`FIELD_ACCOUNTANT`) | `field@uas-ye.com` | `field_accountant` | `123456` | تسجيل المصروفات الميدانية وأجور العمال والعمليات اليومية |
| **مدقق مالي** (`EXTERNAL_AUDITOR`) | `auditor@uas-ye.com` | `financial_auditor` | `123456` | استعراض ومراجعة القوائم المالية وسجل التدقيق (قراءة فقط) |

> ⚠️ **تنبيه أمني هام فور التشغيل الأول:**
> 1. سجل الدخول بحساب **مدير النظام العام** (`admin@uas-ye.com` / `123456`).
> 2. اضغط على أيقونة الحساب في الشريط العلوي لفتح **ملفي الشخصي والأمان (User Profile & Security)**، وقم بتغيير كلمة المرور الافتراضية فوراً.
> 3. من تبويب **إدارة النظام (System Admin)** يمكنك تخصيص اسم المؤسسة والشعار، وإعادة تعيين كلمات مرور بقية الموظفين أو تعديل صلاحياتهم.

---
---

## 🇬🇧 Second: English Quick-Start Guide

### 1. Copy from USB Drive to Local SSD (`C:\UAS-System`)
For maximum SQLite database speed and reliability:
1. Plug the USB flash drive into the main Windows PC in your office.
2. Copy the entire **`UAS-USB-Package`** folder to **`C:\UAS-System`** (or your local SSD Desktop).
3. Ensure **Node.js (v20 LTS or newer)** is installed on the host PC (client PCs and Android phones require zero setup).

### 2. Launch the Server on Windows
Double-click one of the included launchers inside `C:\UAS-System`:
- **`Start-UAS-Office-LAN.bat`** *(or `Start-UAS-Office-Server.bat` — Recommended for Office Multi-User Wi-Fi/LAN)*:
  - Automatically initializes a clean zero-transaction SQLite database (`prisma/uas-enterprise.db`) on first boot.
  - Detects your PC's local LAN IP address (`192.168.x.x`).
  - Opens Windows Firewall TCP port `3000` (with non-admin fallback).
  - Starts the Next.js production server on `0.0.0.0:3000`, opens `http://localhost:3000` in your browser, and displays the exact `http://<LAN-IP>:3000` URL for your team's computers and Android phones.
- **`Start-UAS-Local.bat`**:
  - Starts the system in single-PC local mode (`http://localhost:3000`).
- **`Reset-Clean-Database.bat`**:
  - Resets the SQLite database back to a fresh zero-transaction baseline (6-generation COA skeleton, Main Cash Vault `0.00`, default exchange rates, and the 7 RBAC roles) whenever you are ready to wipe training entries and start live accounting.

### 3. Install `UAS-Mobile-App.apk` on Android Phones
1. Open the **`Android-Mobile`** folder and copy **`UAS-Mobile-App.apk`** to your Android phone via USB cable, OTG flash drive, or local share.
2. Tap **`UAS-Mobile-App.apk`** on the phone to install.
3. Connect the phone to the same Office Wi-Fi network as the host PC.
4. Open the app, expand **"Office LAN / Cloud Server Connection"** on the login screen, enter the LAN URL displayed on the host PC (`http://192.168.x.x:3000`) or `https://qat.world`, and tap **Save & Connect**.

### 4. Default Sign-In & First-Time Security
- **Default Admin Login:** `admin@uas-ye.com` (or username `system_owner`)
- **Default Password:** `123456`
- Immediately after signing in, click your profile badge in the top bar to open the **User Profile Drawer**, set your personal display name, and change the default password.

