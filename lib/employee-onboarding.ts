import { normalizeOrgCode } from "./signup.ts";

export const EMPLOYEE_GUIDE_COPIED_MESSAGE =
  "Employee guide copied. Paste it into an email or store chat.";

export function guideDealershipName(name?: string | null): string {
  const cleaned = name?.trim() ?? "";
  return cleaned || "your dealership";
}

export function guideJoinCode(code?: string | null): string {
  const cleaned = normalizeOrgCode(code ?? "");
  return cleaned || "[Dealership Share Code]";
}

export type EmployeeGuideSection = {
  title: string;
  steps: string[];
};

export function employeeOnboardingSections(input: {
  orgName?: string | null;
  joinCode?: string | null;
}): EmployeeGuideSection[] {
  const name = guideDealershipName(input.orgName);
  const code = guideJoinCode(input.joinCode);
  return [
    {
      title: "Register and join the store",
      steps: [
        `Open Pay Tracker and choose Create Account, then Join Existing Team.`,
        `Enter the Dealership Share Code for ${name}: ${code}. Codes are not case-sensitive.`,
        `When the code connects, pick your rooftop from Select Your Location / Store, then create the account. Join-code signups are Sales Reps locked to that store.`,
        `Already signed in without a store? Use Join Dealership / Connect to Dealership on the home screen, enter ${code}, pick your rooftop, and tap Connect Account.`,
      ],
    },
    {
      title: "Select your store location",
      steps: [
        `After you join, confirm the header Store picker shows your rooftop. That filter controls which worksheets and alerts you see.`,
        `If the store is wrong, change it in the Store picker. If you see Join Dealership instead, you are not linked yet — connect with ${code}.`,
      ],
    },
    {
      title: "Log deals and track pay",
      steps: [
        `From home, add or open a month, then open a worksheet (1st–15th or 16th–end).`,
        `Add each delivered deal: stock #, customer, deal type, trade-in, gross, flat, F&I, and service. Tab from the last Service cell to add another row.`,
        `The sheet totals delivered units, trades, pack %, and estimated pay as you type. Vacation hours × hourly rate and named bonuses sit in Other pay.`,
        `Your numbers save to this browser and, when you are signed in, to the cloud. Use Check for Updates if a manager just pushed a sheet.`,
      ],
    },
    {
      title: "Review and approve manager pushes",
      steps: [
        `When a manager pushes a worksheet, an amber banner appears: “Manager has pushed an updated pay sheet for your review.”`,
        `Open Review Pushed Sheet to compare your live worksheet with the manager version. Differing cells are highlighted.`,
        `Tap Accept & Lock (Accept & Sync) to take the manager numbers and send them to the manager queue, or Flag Dispute / Leave Note if something is wrong.`,
      ],
    },
    {
      title: "Print a clean turn-in worksheet",
      steps: [
        `Open the worksheet you are turning in and tap Print sheet.`,
        `The printout is a one-page landscape recap: deals, vacation, and final total pay. Navigation, editors, and mix charts stay off the page.`,
        `Use the browser print dialog (Save as PDF if you need a file) and turn the sheet in to your desk or payroll.`,
      ],
    },
  ];
}

export function employeeOnboardingEmailText(input: {
  orgName?: string | null;
  joinCode?: string | null;
}): string {
  const name = guideDealershipName(input.orgName);
  const code = guideJoinCode(input.joinCode);
  const sections = employeeOnboardingSections(input);
  const lines = [
    `${name} — Employee Quick-Start Guide`,
    `Dealership share code: ${code}`,
    "",
    "Use this checklist to join Pay Tracker, log deals, review manager pushes, and print a clean turn-in sheet.",
    "",
  ];
  sections.forEach((section, index) => {
    lines.push(`${index + 1}. ${section.title}`);
    for (const step of section.steps) {
      lines.push(`   - ${step}`);
    }
    lines.push("");
  });
  lines.push("Questions? Ask your desk manager or store admin.");
  return lines.join("\n").trim() + "\n";
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  if (typeof document === "undefined") return false;
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  } catch {
    return false;
  }
}
