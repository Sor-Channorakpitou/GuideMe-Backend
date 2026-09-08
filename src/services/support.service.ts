import prisma from "../config/db.js";
import { sendContactNotification } from "./email.js";

export const FAQ_DATA = [
  {
    category: "general",
    question: "តើ GuideMe ជាអ្វី?",
    answer:
      "GuideMe ជាឧបករណ៍ណែនាំឌីជីថលដែលប្រើ AI ដើម្បីជួយអ្នកបញ្ចប់កិច្ចការឌីជីថលមួយជំហានម្តងៗ ជាភាសាខ្មែរ និងអង់គ្លេស។",
  },
  {
    category: "general",
    question: "តើ GuideMe ឥតគិតថ្លៃទេ?",
    answer:
      "GuideMe មានកំណែឥតគិតថ្លៃជាមួយនឹងមុខងារមូលដ្ឋាន។ អ្នកអាចដំឡើងកំណែ Pro ឬ Enterprise សម្រាប់មុខងារបន្ថែម។",
  },
  {
    category: "install",
    question: "តើធ្វើដូចម្តេចដើម្បីដំឡើង GuideMe?",
    answer:
      "ចុចប៊ូតុង 'បន្ថែម GuideMe ទៅ Chrome' នៅលើគេហទំព័ររបស់យើង ហើយធ្វើតាមការណែនាំ។",
  },
  {
    category: "install",
    question: "តើ GuideMe ដំណើរការលើកម្មវិធីរុករកអ្វីខ្លះ?",
    answer:
      "បច្ចុប្បន្ន GuideMe គាំទ្រ Google Chrome ហើយយើងកំពុងអភិវឌ្ឍសម្រាប់កម្មវិធីរុករកផ្សេងទៀត។",
  },
  {
    category: "billing",
    question: "តើខ្ញុំអាចផ្លាស់ប្តូរផែនការរបស់ខ្ញុំដោយរបៀបណា?",
    answer:
      "ចូលទៅកាន់ទំព័រ Subscription ជ្រើសរើសផែនការដែលអ្នកចង់បាន ហើយចុច 'Switch to Plan'។",
  },
  {
    category: "billing",
    question: "តើការទូទាត់មានសុវត្ថិភាពទេ?",
    answer:
      "បាទ ការទូទាត់ទាំងអស់ត្រូវបានអ៊ិនគ្រីប និងការពារដោយស្តង់ដារសុវត្ថិភាពឧស្សាហកម្ម។",
  },
  {
    category: "privacy",
    question: "តើទិន្នន័យរបស់ខ្ញុំត្រូវបានការពារយ៉ាងដូចម្តេច?",
    answer:
      "យើងគោរពឯកជនភាពរបស់អ្នក។ ទិន្នន័យទាំងអស់ត្រូវបានអ៊ិនគ្រីប ហើយយើងមិនចែករំលែកព័ត៌មានផ្ទាល់ខ្លួនរបស់អ្នកជាមួយភាគីទីបីឡើយ។",
  },
  {
    category: "privacy",
    question: "តើខ្ញុំអាចលុបគណនីរបស់ខ្ញុំដោយរបៀបណា?",
    answer:
      "ចូលទៅកាន់ Settings > ស្វែងរក 'Delete Account' ហើយធ្វើតាមការណែនាំ។ សូមប្រុងប្រយ័ត្ន សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ។",
  },
];

export async function createSupportTicket(
  userId: string | null,
  data: { category: string; subject: string; message: string; name?: string; email?: string }
) {
  const ticket = await prisma.supportTicket.create({
    data: {
      category: data.category,
      subject: data.subject,
      message: data.message,
      ...(userId ? { userId } : {}),
    } as any,
  });

  const user = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      })
    : null;

  await sendContactNotification({
    name: data.name || user?.name || data.subject,
    email: data.email || user?.email || "unknown@guideme.app",
    category: data.category,
    message: data.message,
  });

  console.log(`[SUPPORT] New ticket #${ticket.id}${userId ? ` from user ${userId}` : ""}: ${data.subject}`);
  return ticket;
}

export function getFaqList(category?: string) {
  return category ? FAQ_DATA.filter((f) => f.category === category) : FAQ_DATA;
}
