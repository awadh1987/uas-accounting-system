export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export type DocStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "POSTED"
  | "PARTIALLY_PAID"
  | "PAID"
  | "VOIDED";

export type UserRole =
  | "SUPER_ADMIN"
  | "PROJECT_MANAGER"
  | "CHIEF_ACCOUNTANT"
  | "FIELD_ACCOUNTANT"
  | "PROCUREMENT_OFFICER"
  | "AUDITOR";

export interface CoaSeedNode {
  code: string;
  nameAr: string;
  nameEn: string;
  level: 1 | 2 | 3 | 4 | 5;
  type: AccountType;
  isPosting: boolean;
  parentCode: string | null;
}

/**
 * Standard 5-Tier Chart of Accounts (COA) Architecture for UAS:
 * Level 1 (Class) -> Level 2 (Group) -> Level 3 (Control) -> Level 4 (Sub-Control) -> Level 5 (Detail/Posting)
 * Only Level 5 accounts have isPosting = true and accept direct journal lines.
 */
export const STANDARD_COA_NODES: CoaSeedNode[] = [
  // =========================================================================
  // 100000 ASSETS (الأصول)
  // =========================================================================
  { code: "100000", nameAr: "الأصول", nameEn: "ASSETS", level: 1, type: "ASSET", isPosting: false, parentCode: null },
  { code: "110000", nameAr: "الأصول المتداولة", nameEn: "Current Assets", level: 2, type: "ASSET", isPosting: false, parentCode: "100000" },
  { code: "111000", nameAr: "النقدية وما في حكمها", nameEn: "Cash and Cash Equivalents", level: 3, type: "ASSET", isPosting: false, parentCode: "110000" },
  { code: "111100", nameAr: "الصناديق المركزية", nameEn: "Main Vault & Treasuries", level: 4, type: "ASSET", isPosting: false, parentCode: "111000" },
  { code: "111101", nameAr: "الصندوق الرئيسي - يمني", nameEn: "Central Safe - YER", level: 5, type: "ASSET", isPosting: true, parentCode: "111100" },
  { code: "111102", nameAr: "صندوق الريال السعودي", nameEn: "Central Safe - SAR", level: 5, type: "ASSET", isPosting: true, parentCode: "111100" },
  { code: "111103", nameAr: "صندوق الدولار", nameEn: "Central Safe - USD", level: 5, type: "ASSET", isPosting: true, parentCode: "111100" },
  { code: "111200", nameAr: "البنوك والمحافظ الإلكترونية", nameEn: "Bank Accounts & Electronic Wallets", level: 4, type: "ASSET", isPosting: false, parentCode: "111000" },
  { code: "111201", nameAr: "بنك الكريمي الإسلامي", nameEn: "Kuraimi Islamic Bank", level: 5, type: "ASSET", isPosting: true, parentCode: "111200" },
  { code: "111202", nameAr: "بنك القطيبي", nameEn: "Al-Qutaibi Bank", level: 5, type: "ASSET", isPosting: true, parentCode: "111200" },
  { code: "111203", nameAr: "محفظة فلوسك / جوالي", nameEn: "Floosak / Jawali Wallet", level: 5, type: "ASSET", isPosting: true, parentCode: "111200" },
  { code: "111204", nameAr: "محفظة جيب", nameEn: "Jeeb Electronic Wallet", level: 5, type: "ASSET", isPosting: true, parentCode: "111200" },

  { code: "112000", nameAr: "العملاء والمدينون", nameEn: "Trade Receivables & Clients", level: 3, type: "ASSET", isPosting: false, parentCode: "110000" },
  { code: "112100", nameAr: "مدينو المشاريع", nameEn: "Project Commercial Debtors", level: 4, type: "ASSET", isPosting: false, parentCode: "112000" },
  { code: "112101", nameAr: "فواز الجابري", nameEn: "Fawaz Al-Jabri", level: 5, type: "ASSET", isPosting: true, parentCode: "112100" },
  { code: "112102", nameAr: "يوسف الجابري", nameEn: "Youssef Al-Jabri", level: 5, type: "ASSET", isPosting: true, parentCode: "112100" },

  { code: "113000", nameAr: "المخزون والأصول الحيوية", nameEn: "Inventories & Biological Stock", level: 3, type: "ASSET", isPosting: false, parentCode: "110000" },
  { code: "113100", nameAr: "مخزون المحاصيل والعلاقيات", nameEn: "Agricultural Goods & Harvest Lots", level: 4, type: "ASSET", isPosting: false, parentCode: "113000" },
  { code: "113101", nameAr: "علاقيات صنف 1 ممتاز", nameEn: "Grade 1 Premium Stock", level: 5, type: "ASSET", isPosting: true, parentCode: "113100" },
  { code: "113102", nameAr: "علاقيات صنف 2 وسط", nameEn: "Grade 2 Standard Stock", level: 5, type: "ASSET", isPosting: true, parentCode: "113100" },
  { code: "113103", nameAr: "محصول خام قيد الفرز", nameEn: "Raw Harvest Unsorted", level: 5, type: "ASSET", isPosting: true, parentCode: "113100" },
  { code: "113200", nameAr: "المستلزمات الزراعية والمواد", nameEn: "Agricultural Inputs & Consumables", level: 4, type: "ASSET", isPosting: false, parentCode: "113000" },
  { code: "113201", nameAr: "مخزون الأسمدة والمبيدات", nameEn: "Fertilizer & Chemicals Stock", level: 5, type: "ASSET", isPosting: true, parentCode: "113200" },
  { code: "113202", nameAr: "مخزون الوقود والمحروقات", nameEn: "Diesel & Fuel Reserves", level: 5, type: "ASSET", isPosting: true, parentCode: "113200" },
  { code: "113203", nameAr: "أدوات التعبئة والتغليف", nameEn: "Packaging & Crates", level: 5, type: "ASSET", isPosting: true, parentCode: "113200" },

  { code: "114000", nameAr: "السلف والمصروفات المدفوعة مقدماً", nameEn: "Advances, Prepayments & Unbilled Work", level: 3, type: "ASSET", isPosting: false, parentCode: "110000" },
  { code: "114100", nameAr: "سلف ومقدمات الموردين", nameEn: "Advance Payments to Suppliers", level: 4, type: "ASSET", isPosting: false, parentCode: "114000" },
  { code: "114101", nameAr: "مقدمات مشتريات الموردين", nameEn: "Vendor Advances - Procurement", level: 5, type: "ASSET", isPosting: true, parentCode: "114100" },
  { code: "114200", nameAr: "سلف وعهد العمال والمزارعين", nameEn: "Worker Advances", level: 4, type: "ASSET", isPosting: false, parentCode: "114000" },
  { code: "114201", nameAr: "حساب سلف العمال", nameEn: "Worker Advances Ledger", level: 5, type: "ASSET", isPosting: true, parentCode: "114200" },

  { code: "120000", nameAr: "الأصول غير المتداولة", nameEn: "Non-Current Assets", level: 2, type: "ASSET", isPosting: false, parentCode: "100000" },
  { code: "121000", nameAr: "الأراضي، الآبار، والآلات", nameEn: "Property, Land, Wells & Equipment", level: 3, type: "ASSET", isPosting: false, parentCode: "120000" },
  { code: "121100", nameAr: "الأراضي والمزارع", nameEn: "Farms & Landed Estates", level: 4, type: "ASSET", isPosting: false, parentCode: "121000" },
  { code: "121101", nameAr: "أراضي ومزارع مشاريع الجبري", nameEn: "Al-Jabri Agricultural Estates", level: 5, type: "ASSET", isPosting: true, parentCode: "121100" },
  { code: "121200", nameAr: "الآبار ومنظومات الطاقة الشمسية", nameEn: "Wells, Pumps & Solar Irrigation", level: 4, type: "ASSET", isPosting: false, parentCode: "121000" },
  { code: "121201", nameAr: "منظومات الضخ الشمسي والآبار", nameEn: "Solar Pumping & Borehole Systems", level: 5, type: "ASSET", isPosting: true, parentCode: "121200" },

  // =========================================================================
  // 200000 LIABILITIES (الالتزامات)
  // =========================================================================
  { code: "200000", nameAr: "الالتزامات", nameEn: "LIABILITIES", level: 1, type: "LIABILITY", isPosting: false, parentCode: null },
  { code: "210000", nameAr: "الالتزامات المتداولة", nameEn: "Current Liabilities", level: 2, type: "LIABILITY", isPosting: false, parentCode: "200000" },
  { code: "211000", nameAr: "الموردون والتجاريون", nameEn: "Trade Payables & Vendors", level: 3, type: "LIABILITY", isPosting: false, parentCode: "210000" },
  { code: "211100", nameAr: "ذمم موردي المشتريات", nameEn: "Procurement Vendors Payable", level: 4, type: "LIABILITY", isPosting: false, parentCode: "211000" },
  { code: "211101", nameAr: "شركة التوريدات الزراعية", nameEn: "General Agricultural Supplies Co.", level: 5, type: "LIABILITY", isPosting: true, parentCode: "211100" },
  { code: "211102", nameAr: "محطة الوقود والطاقة المركزية", nameEn: "Fuel & Energy Station Vendor", level: 5, type: "LIABILITY", isPosting: true, parentCode: "211100" },
  { code: "211103", nameAr: "مورد قطع الغيار والصيانة", nameEn: "Equipment Spare Parts Vendor", level: 5, type: "LIABILITY", isPosting: true, parentCode: "211100" },

  { code: "212000", nameAr: "أجور العمال المستحقة", nameEn: "Accrued Worker Wages & Benefits", level: 3, type: "LIABILITY", isPosting: false, parentCode: "210000" },
  { code: "212100", nameAr: "مستحقات عمال الأجر اليومي والقطفات", nameEn: "Harvest & Daily Labor Payables", level: 4, type: "LIABILITY", isPosting: false, parentCode: "212000" },
  { code: "212101", nameAr: "مستحقات العامل بلال", nameEn: "Bilal Labor Payable", level: 5, type: "LIABILITY", isPosting: true, parentCode: "212100" },
  { code: "212102", nameAr: "مستحقات العامل معاذ", nameEn: "Moath Labor Payable", level: 5, type: "LIABILITY", isPosting: true, parentCode: "212100" },
  { code: "212103", nameAr: "مستحقات العامل فواز", nameEn: "Fawaz Labor Payable", level: 5, type: "LIABILITY", isPosting: true, parentCode: "212100" },

  { code: "213000", nameAr: "تأمينات ومقدمات العملاء", nameEn: "Unearned Revenue & Customer Deposits", level: 3, type: "LIABILITY", isPosting: false, parentCode: "210000" },
  { code: "213100", nameAr: "دفعات مقدمة من العملاء", nameEn: "Client Advances & Pre-orders", level: 4, type: "LIABILITY", isPosting: false, parentCode: "213000" },
  { code: "213101", nameAr: "دفعات عملاء تحت الحساب", nameEn: "Client Pre-order Deposits", level: 5, type: "LIABILITY", isPosting: true, parentCode: "213100" },

  // =========================================================================
  // 300000 EQUITY (حقوق الملكية)
  // =========================================================================
  { code: "300000", nameAr: "حقوق الملكية", nameEn: "EQUITY", level: 1, type: "EQUITY", isPosting: false, parentCode: null },
  { code: "310000", nameAr: "رأس المال والاحتياطيات", nameEn: "Capital & Retained Reserves", level: 2, type: "EQUITY", isPosting: false, parentCode: "300000" },
  { code: "311000", nameAr: "رأس مال الملاك والشركاء", nameEn: "Owner Capital Accounts", level: 3, type: "EQUITY", isPosting: false, parentCode: "310000" },
  { code: "311100", nameAr: "رأس المال المدفوع", nameEn: "Paid-In Capital", level: 4, type: "EQUITY", isPosting: false, parentCode: "311000" },
  { code: "311101", nameAr: "رأس المال المدفوع - الجبري", nameEn: "Paid-In Enterprise Capital", level: 5, type: "EQUITY", isPosting: true, parentCode: "311100" },

  { code: "312000", nameAr: "الأرباح المبقاة / المحتجزة", nameEn: "Retained Earnings", level: 3, type: "EQUITY", isPosting: false, parentCode: "310000" },
  { code: "312100", nameAr: "الأرباح المحتجزة المرحلة", nameEn: "Accumulated Retained Earnings", level: 4, type: "EQUITY", isPosting: false, parentCode: "312000" },
  { code: "312101", nameAr: "حساب الأرباح المبقاة", nameEn: "Retained Earnings Ledger", level: 5, type: "EQUITY", isPosting: true, parentCode: "312100" },

  { code: "313000", nameAr: "صافي نتائج العام المالي الجاري", nameEn: "Current Year Net Operating Result", level: 3, type: "EQUITY", isPosting: false, parentCode: "310000" },
  { code: "313100", nameAr: "نتيجة العام المالي الجاري", nameEn: "Current Fiscal Year Result", level: 4, type: "EQUITY", isPosting: false, parentCode: "313000" },
  { code: "313101", nameAr: "ملخص أرباح وخسائر العام", nameEn: "Current Year Profit/Loss Summary", level: 5, type: "EQUITY", isPosting: true, parentCode: "313100" },

  // =========================================================================
  // 400000 REVENUE (الإيرادات)
  // =========================================================================
  { code: "400000", nameAr: "الإيرادات", nameEn: "REVENUE", level: 1, type: "REVENUE", isPosting: false, parentCode: null },
  { code: "410000", nameAr: "إيرادات النشاط والمبيعات", nameEn: "Operating Revenue & Sales", level: 2, type: "REVENUE", isPosting: false, parentCode: "400000" },
  { code: "411000", nameAr: "مبيعات محاصيل المشاريع", nameEn: "Project Harvest Sales", level: 3, type: "REVENUE", isPosting: false, parentCode: "410000" },
  { code: "411100", nameAr: "مبيعات الجبري العليا", nameEn: "Upper Jabri Sales", level: 4, type: "REVENUE", isPosting: false, parentCode: "411000" },
  { code: "411101", nameAr: "إيراد مبيعات قطفات الجبري العليا", nameEn: "Upper Jabri Harvest Sales", level: 5, type: "REVENUE", isPosting: true, parentCode: "411100" },
  { code: "411200", nameAr: "مبيعات الجبري الوسطى", nameEn: "Middle Jabri Sales", level: 4, type: "REVENUE", isPosting: false, parentCode: "411000" },
  { code: "411201", nameAr: "إيراد مبيعات قطفات الجبري الوسطى", nameEn: "Middle Jabri Harvest Sales", level: 5, type: "REVENUE", isPosting: true, parentCode: "411200" },
  { code: "411300", nameAr: "مبيعات الجبري السفلى", nameEn: "Lower Jabri Sales", level: 4, type: "REVENUE", isPosting: false, parentCode: "411000" },
  { code: "411301", nameAr: "إيراد مبيعات قطفات الجبري السفلى", nameEn: "Lower Jabri Harvest Sales", level: 5, type: "REVENUE", isPosting: true, parentCode: "411300" },

  { code: "412000", nameAr: "إيرادات خدمات زراعية ومشتقات", nameEn: "By-Products & Agricultural Services", level: 3, type: "REVENUE", isPosting: false, parentCode: "410000" },
  { code: "412100", nameAr: "مشتقات وخدمات زراعية", nameEn: "Agricultural By-Products", level: 4, type: "REVENUE", isPosting: false, parentCode: "412000" },
  { code: "412101", nameAr: "إيرادات خدمات ومشتقات زراعية", nameEn: "Agricultural Services & By-Products Revenue", level: 5, type: "REVENUE", isPosting: true, parentCode: "412100" },

  // =========================================================================
  // 500000 EXPENSES & COSTS (المصروفات والتكاليف)
  // =========================================================================
  { code: "500000", nameAr: "المصروفات والتكاليف", nameEn: "EXPENSES & COSTS", level: 1, type: "EXPENSE", isPosting: false, parentCode: null },
  { code: "510000", nameAr: "تكاليف الإنتاج والقطاف", nameEn: "Cost of Goods Sold / Harvest Cost", level: 2, type: "EXPENSE", isPosting: false, parentCode: "500000" },
  { code: "511000", nameAr: "أجور القطف والعمالة المباشرة", nameEn: "Direct Farming & Harvest Labor", level: 3, type: "EXPENSE", isPosting: false, parentCode: "510000" },
  { code: "511100", nameAr: "أجور عمالة الحصاد والقطف", nameEn: "Daily Harvest Wages", level: 4, type: "EXPENSE", isPosting: false, parentCode: "511000" },
  { code: "511101", nameAr: "مصروف أجور العمالة المباشرة", nameEn: "Direct Harvest Labor Expense", level: 5, type: "EXPENSE", isPosting: true, parentCode: "511100" },

  { code: "512000", nameAr: "تكاليف مدخلات الإنتاج المستهلكة", nameEn: "Direct Procurement & Inputs Consumed", level: 3, type: "EXPENSE", isPosting: false, parentCode: "510000" },
  { code: "512100", nameAr: "المدخلات والمستلزمات المستهلكة", nameEn: "Inputs Consumed", level: 4, type: "EXPENSE", isPosting: false, parentCode: "512000" },
  { code: "512101", nameAr: "مصروف مدخلات الإنتاج المستهلكة", nameEn: "Direct Agricultural Inputs Expense", level: 5, type: "EXPENSE", isPosting: true, parentCode: "512100" },

  { code: "520000", nameAr: "المصروفات التشغيلية للمشاريع", nameEn: "Operating Expenses", level: 2, type: "EXPENSE", isPosting: false, parentCode: "500000" },
  { code: "521000", nameAr: "وقود ومحروقات وطاقة", nameEn: "Fuel, Diesel & Power", level: 3, type: "EXPENSE", isPosting: false, parentCode: "520000" },
  { code: "521100", nameAr: "وقود المضخات والآليات", nameEn: "Pumps & Field Fuel", level: 4, type: "EXPENSE", isPosting: false, parentCode: "521000" },
  { code: "521101", nameAr: "مصروف الديزل والوقود", nameEn: "Diesel & Fuel Expense", level: 5, type: "EXPENSE", isPosting: true, parentCode: "521100" },

  { code: "522000", nameAr: "وجبات وإعاشة العمال", nameEn: "Worker Meals & Catering", level: 3, type: "EXPENSE", isPosting: false, parentCode: "520000" },
  { code: "522100", nameAr: "إعاشة ووجبات الحصاد", nameEn: "Catering & Provisions", level: 4, type: "EXPENSE", isPosting: false, parentCode: "522000" },
  { code: "522101", nameAr: "مصروف الوجبات والمواد الغذائية", nameEn: "Worker Meals & Provisions Expense", level: 5, type: "EXPENSE", isPosting: true, parentCode: "522100" },

  { code: "523000", nameAr: "أجور النقل والتوريد", nameEn: "Transport, Logistics & Cartage", level: 3, type: "EXPENSE", isPosting: false, parentCode: "520000" },
  { code: "523100", nameAr: "نقل العمال والمحاصيل", nameEn: "Field Logistics & Transport", level: 4, type: "EXPENSE", isPosting: false, parentCode: "523000" },
  { code: "523101", nameAr: "مصروف النقل والتوريد", nameEn: "Transport & Cartage Expense", level: 5, type: "EXPENSE", isPosting: true, parentCode: "523100" },

  { code: "524000", nameAr: "صيانة المزرعة والعدد", nameEn: "Farm Maintenance & Consumable Equipment", level: 3, type: "EXPENSE", isPosting: false, parentCode: "520000" },
  { code: "524100", nameAr: "صيانة وعدة زراعية", nameEn: "Maintenance & Field Supplies", level: 4, type: "EXPENSE", isPosting: false, parentCode: "524000" },
  { code: "524101", nameAr: "مصروف الصيانة والمصروفات الأخرى", nameEn: "Maintenance & Miscellaneous Operating Expense", level: 5, type: "EXPENSE", isPosting: true, parentCode: "524100" },

  { code: "530000", nameAr: "المصروفات الإدارية والعمومية", nameEn: "Administrative & General Expenses", level: 2, type: "EXPENSE", isPosting: false, parentCode: "500000" },
  { code: "531000", nameAr: "مصروفات إدارية ومراجعة", nameEn: "Office, Audit & Governance Expenses", level: 3, type: "EXPENSE", isPosting: false, parentCode: "530000" },
  { code: "531100", nameAr: "مصروفات إدارية عامة", nameEn: "General Admin Expenses", level: 4, type: "EXPENSE", isPosting: false, parentCode: "531000" },
  { code: "531101", nameAr: "مصروفات إدارية وعمومية", nameEn: "General & Administrative Expense", level: 5, type: "EXPENSE", isPosting: true, parentCode: "531100" },
  { code: "531200", nameAr: "عمولات ورسوم البنوك والمحافظ", nameEn: "Bank & Wallet Transfer Fees", level: 4, type: "EXPENSE", isPosting: false, parentCode: "531000" },
  { code: "531201", nameAr: "رسوم التحويلات البنكية والإلكترونية", nameEn: "Remittance & Wallet Transfer Fees", level: 5, type: "EXPENSE", isPosting: true, parentCode: "531200" },
];

export function mapExpenseCategoryToCoaCode(category: string): string {
  switch (category.trim()) {
    case "وقود/محروقات":
      return "521101";
    case "وجبات غذائية":
    case "مواد غذائية":
      return "522101";
    case "أجور نقل":
      return "523101";
    default:
      return "524101";
  }
}

export function mapProjectIdToSalesRevenueCode(projectCodeOrId: string): string {
  if (projectCodeOrId === "p2" || projectCodeOrId === "PRJ-002") return "411201";
  if (projectCodeOrId === "p3" || projectCodeOrId === "PRJ-003") return "411301";
  return "411101";
}

