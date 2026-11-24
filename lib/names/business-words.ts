/**
 * Words for businesses (LATER_CHANGES_PLAN.md §3.1, step 2, PR 399), for a
 * client's name and the company's: each in Arabic and in English, with where
 * each language puts it. Written for Nizmo.
 *
 * - `before`: before the name in Arabic and after it in English, after any
 *   `after` words: شركة النور للتجارة is El Nour Trading Company.
 * - `after`: after the name in both, in the same order.
 * - `last`: last in both: النور للتجارة وشركاه is El Nour Trading & Partners.
 *
 * A word of several, such as للاستيراد والتصدير, is matched whole, before
 * any of its words alone.
 */

export type BusinessWord = { ar: string; en: string; place: "before" | "after" | "last" }

export const BUSINESS_WORDS: readonly BusinessWord[] = [
    // What the business is: first in Arabic, last in English.
    { ar: "شركة", en: "Company", place: "before" },
    { ar: "مكتب", en: "Office", place: "before" },
    { ar: "مؤسسة", en: "Establishment", place: "before" },
    { ar: "مجموعة", en: "Group", place: "before" },
    { ar: "مصنع", en: "Factory", place: "before" },
    { ar: "مركز", en: "Center", place: "before" },
    { ar: "معرض", en: "Showroom", place: "before" },
    { ar: "مطعم", en: "Restaurant", place: "before" },
    { ar: "صيدلية", en: "Pharmacy", place: "before" },
    { ar: "عيادة", en: "Clinic", place: "before" },
    { ar: "مستشفى", en: "Hospital", place: "before" },
    { ar: "مدرسة", en: "School", place: "before" },
    { ar: "أكاديمية", en: "Academy", place: "before" },
    { ar: "فندق", en: "Hotel", place: "before" },
    { ar: "مكتبة", en: "Bookshop", place: "before" },
    { ar: "معمل", en: "Lab", place: "before" },
    { ar: "ورشة", en: "Workshop", place: "before" },
    { ar: "جمعية", en: "Association", place: "before" },
    { ar: "مطبعة", en: "Press", place: "before" },
    { ar: "مخبز", en: "Bakery", place: "before" },
    { ar: "مزرعة", en: "Farm", place: "before" },
    { ar: "معهد", en: "Institute", place: "before" },

    // What it does: after the name in both.
    { ar: "للتجارة", en: "Trading", place: "after" },
    { ar: "للمحاسبة والمراجعة", en: "Accounting & Auditing", place: "after" },
    { ar: "للمحاسبة", en: "Accounting", place: "after" },
    { ar: "للمراجعة", en: "Auditing", place: "after" },
    { ar: "للمقاولات", en: "Contracting", place: "after" },
    { ar: "للمقاولات العامة", en: "General Contracting", place: "after" },
    { ar: "للاستيراد والتصدير", en: "Import & Export", place: "after" },
    { ar: "للتوريدات", en: "Supplies", place: "after" },
    { ar: "للتوريدات العمومية", en: "General Supplies", place: "after" },
    { ar: "للخدمات", en: "Services", place: "after" },
    { ar: "للاستثمار العقاري", en: "Real Estate Investment", place: "after" },
    { ar: "للاستثمار", en: "Investment", place: "after" },
    { ar: "للتطوير العقاري", en: "Real Estate Development", place: "after" },
    { ar: "للصناعات الغذائية", en: "Food Industries", place: "after" },
    { ar: "للصناعات", en: "Industries", place: "after" },
    { ar: "للتسويق", en: "Marketing", place: "after" },
    { ar: "للسياحة والسفر", en: "Travel & Tourism", place: "after" },
    { ar: "للسياحة", en: "Tourism", place: "after" },
    { ar: "للنقل", en: "Transport", place: "after" },
    { ar: "للشحن", en: "Shipping", place: "after" },
    { ar: "للبرمجيات", en: "Software", place: "after" },
    { ar: "لتكنولوجيا المعلومات", en: "Information Technology", place: "after" },
    { ar: "للأغذية", en: "Foods", place: "after" },
    { ar: "للمواد الغذائية", en: "Food Products", place: "after" },
    { ar: "للأدوية", en: "Pharmaceuticals", place: "after" },
    { ar: "للأجهزة الطبية", en: "Medical Devices", place: "after" },
    { ar: "للهندسة", en: "Engineering", place: "after" },
    { ar: "للاستشارات الهندسية", en: "Engineering Consulting", place: "after" },
    { ar: "للاستشارات", en: "Consulting", place: "after" },
    { ar: "للتأمين", en: "Insurance", place: "after" },
    { ar: "للدعاية والإعلان", en: "Advertising", place: "after" },
    { ar: "للطباعة", en: "Printing", place: "after" },
    { ar: "للتعليم", en: "Education", place: "after" },
    { ar: "للمعدات", en: "Equipment", place: "after" },
    { ar: "للأثاث", en: "Furniture", place: "after" },
    { ar: "للملابس الجاهزة", en: "Ready Made Garments", place: "after" },
    { ar: "للملابس", en: "Clothing", place: "after" },
    { ar: "للبلاستيك", en: "Plastics", place: "after" },
    { ar: "للكيماويات", en: "Chemicals", place: "after" },
    { ar: "للحديد والصلب", en: "Iron & Steel", place: "after" },
    { ar: "للزراعة", en: "Agriculture", place: "after" },
    { ar: "للإلكترونيات", en: "Electronics", place: "after" },
    { ar: "للأمن والحراسة", en: "Security", place: "after" },
    { ar: "للنظافة", en: "Cleaning", place: "after" },
    { ar: "للتجارة والتوزيع", en: "Trading & Distribution", place: "after" },
    { ar: "للتوزيع", en: "Distribution", place: "after" },
    { ar: "القابضة", en: "Holding", place: "after" },
    { ar: "الدولية", en: "International", place: "after" },

    // Last in both.
    { ar: "وشركاه", en: "& Partners", place: "last" },
    { ar: "وأولاده", en: "& Sons", place: "last" },
    { ar: "ش.م.م", en: "LLC", place: "last" },
]
