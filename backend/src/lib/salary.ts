import { prisma } from "./prisma";

const BASELINE_MONTH = "0000-00";

/** Current month as "YYYY-MM" in UAE time. */
export function currentMonthStr(): string {
  const d = new Date(Date.now() + 4 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Salary that applies to each employee in the given month, for employees who
 * have salary history. Employees missing from the map have never had a dated
 * change, so their current baseSalary applies to every month.
 */
export async function salariesForMonth(month: string, employeeIds?: string[]): Promise<Record<string, number>> {
  const rows = await prisma.salaryChange.findMany({
    where: {
      effectiveMonth: { lte: month },
      ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
    },
    orderBy: { effectiveMonth: "desc" },
  });
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!(r.employeeId in out)) out[r.employeeId] = r.baseSalary;
  }
  return out;
}

/**
 * Records a salary change that applies from `effectiveFrom` onwards.
 * Months before it keep the old salary. Returns the salary that applies to the
 * current month, which is what User.baseSalary should hold.
 */
export async function recordSalaryChange(
  employeeId: string,
  oldSalary: number,
  newSalary: number,
  effectiveFrom: string
): Promise<number> {
  const existing = await prisma.salaryChange.count({ where: { employeeId } });
  if (existing === 0) {
    await prisma.salaryChange.create({
      data: { employeeId, effectiveMonth: BASELINE_MONTH, baseSalary: oldSalary },
    });
  }
  await prisma.salaryChange.upsert({
    where: { employeeId_effectiveMonth: { employeeId, effectiveMonth: effectiveFrom } },
    update: { baseSalary: newSalary },
    create: { employeeId, effectiveMonth: effectiveFrom, baseSalary: newSalary },
  });
  const now = await salariesForMonth(currentMonthStr(), [employeeId]);
  return now[employeeId] ?? newSalary;
}
