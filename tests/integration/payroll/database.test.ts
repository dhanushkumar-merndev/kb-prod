// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createPayrollDatabase } from "./database-fixture";

const chef = "30000000-0000-4000-8000-000000000002";
const hr = "30000000-0000-4000-8000-000000000001";
const director = "30000000-0000-4000-8000-000000000003";
const otherChef = "30000000-0000-4000-8000-000000000004";
const franchise = "20000000-0000-4000-8000-000000000001";
const otherFranchise = "20000000-0000-4000-8000-000000000002";
const salary = {
  effectiveFrom: "2026-09-01",
  paidLeave: true,
  hra: 3000,
  allowances: 0,
  incentives: 1500,
  pf: 300,
  esic: 0,
  professional_tax: 0,
  tds: 0,
  other_deductions: 0,
  employer_pf: 600,
  employer_esic: 0,
};
let db: PGlite;
async function actor(id: string) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function save(values = salary, version = 0, profileId = chef) {
  return db.query("select save_payroll_salary_structure($1,$2,$3)", [
    profileId,
    JSON.stringify(values),
    version,
  ]);
}
async function generate(start = "2026-09-01", end = "2026-09-30", scope: string | null = null) {
  return (
    await db.query<{ payroll_period_id: string; net_payable: string }>(
      "select * from generate_payroll_period($1::date,$2::date,$3::uuid)",
      [start, end, scope],
    )
  ).rows[0]!;
}
async function attendance(start = "2026-09-01", end = "2026-09-10") {
  await db.query(
    `insert into attendance_shifts(organization_id,franchise_id,profile_id,shift_date,started_at,ended_at,status,payroll_eligible,approved_by_profile_id,approved_at)
    select '10000000-0000-4000-8000-000000000001',$3,$4,d::date,d+interval '9 hours',d+interval '17 hours','approved',true,$5,now()
    from generate_series($1::timestamp,$2::timestamp,interval '1 day') d`,
    [start, end, franchise, chef, hr],
  );
}

beforeAll(async () => {
  db = await createPayrollDatabase();
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("begin");
});
afterEach(async () => {
  await db.exec("rollback");
});

describe("transactional payroll generation", () => {
  it("counts distinct approved days and paid leave without overlap, and includes only approved expenses", async () => {
    await save();
    await attendance();
    await attendance("2026-09-01", "2026-09-01");
    await db.exec(`insert into leave_requests(organization_id,profile_id,start_date,end_date,reason,status) values
      ('10000000-0000-4000-8000-000000000001','${chef}','2026-09-09','2026-09-12','Approved leave','approved'),
      ('10000000-0000-4000-8000-000000000001','${chef}','2026-09-13','2026-09-15','Pending leave','pending');
      insert into expenses(organization_id,submitted_by_profile_id,category,amount,reason,status,reviewed_at,reviewed_by_profile_id) values
      ('10000000-0000-4000-8000-000000000001','${chef}','travel',200,'Travel','approved','2026-09-10','${hr}'),
      ('10000000-0000-4000-8000-000000000001','${chef}','travel',999,'Pending travel','pending',null,null);
      insert into attendance_shifts(organization_id,profile_id,shift_date,started_at,ended_at,status,payroll_eligible) values
      ('10000000-0000-4000-8000-000000000001','${chef}','2026-09-13','2026-09-13 09:00Z','2026-09-13 17:00Z','pending_approval',false);`);
    expect((await generate()).net_payable).toBe("13700.00");
    expect(
      (
        await db.query(
          "select attendance_days,payable_days,base_amount,expense_reimbursement from payroll_entries",
        )
      ).rows[0],
    ).toEqual({
      attendance_days: 10,
      payable_days: 12,
      base_amount: "12000.00",
      expense_reimbursement: "200.00",
    });
    expect(
      (await db.query("select amount from payroll_components where component_type = 'employer_pf'"))
        .rows[0],
    ).toEqual({ amount: "240.00" });
  });
  it("retains the earlier salary structure when a future revision is saved", async () => {
    await save();
    await save({ ...salary, effectiveFrom: "2026-10-01", hra: 6000 }, 1);
    await attendance();
    expect((await generate()).net_payable).toBe("11200.00");
    await attendance("2026-10-01", "2026-10-10");
    expect((await generate("2026-10-01", "2026-10-31")).net_payable).toBe("11796.77");
  });
  it("does not pay unapproved attendance or leave without the saved paid-leave policy", async () => {
    await save({ ...salary, paidLeave: false });
    await db.exec(`insert into leave_requests(organization_id,profile_id,start_date,end_date,reason,status) values
      ('10000000-0000-4000-8000-000000000001','${chef}','2026-09-01','2026-09-30','Leave','approved')`);
    expect((await generate()).net_payable).toBe("0.00");
  });
  it("rolls back the entire draft if configured deductions exceed earnings", async () => {
    await save({ ...salary, pf: 50000 });
    await attendance();
    await db.exec("savepoint invalid_action");
    await expect(generate()).rejects.toThrow("PAYROLL_NEGATIVE_NET");
    await db.exec("rollback to invalid_action");
    expect((await db.query("select count(*)::int as count from payroll_entries")).rows[0]).toEqual({
      count: 0,
    });
    expect((await db.query("select count(*)::int as count from payroll_periods")).rows[0]).toEqual({
      count: 0,
    });
  });
  it("denies salary data and mutations after account deactivation", async () => {
    await save();
    await db.exec(`update profiles set account_status='inactive' where id='${hr}'`);
    await db.exec("set local role authenticated");
    expect(
      (await db.query("select count(*)::int as count from payroll_salary_structures")).rows[0],
    ).toEqual({ count: 0 });
    await db.exec("savepoint invalid_action");
    await expect(save(salary, 1)).rejects.toThrow("PERMISSION_DENIED");
    await db.exec("rollback to invalid_action");
  });
  it("rejects a duplicate period atomically", async () => {
    await attendance();
    await generate();
    await db.exec("savepoint invalid_action");
    await expect(generate()).rejects.toThrow("PAYROLL_PERIOD_OVERLAP");
    await db.exec("rollback to invalid_action");
    expect((await db.query("select count(*)::int as count from payroll_periods")).rows[0]).toEqual({
      count: 1,
    });
  });
  it("rejects stale salary edits and cross-franchise mutations", async () => {
    await save();
    await db.exec("savepoint invalid_action");
    await expect(save()).rejects.toThrow("PAYROLL_STATUS_CONFLICT");
    await db.exec("rollback to invalid_action");
    await expect(save(salary, 0, otherChef)).rejects.toThrow("PERMISSION_DENIED");
    await db.exec("rollback to invalid_action");
    await expect(generate("2026-09-01", "2026-09-30", otherFranchise)).rejects.toThrow(
      "PAYROLL_FRANCHISE_REQUIRED",
    );
    await db.exec("rollback to invalid_action");
    await actor(chef);
    await expect(save()).rejects.toThrow("PERMISSION_DENIED");
    await db.exec("rollback to invalid_action");
  });
  it("allows separate franchises in the same month and requires Director scope", async () => {
    await generate();
    await actor(director);
    await db.exec("savepoint invalid_action");
    await expect(generate()).rejects.toThrow("PAYROLL_FRANCHISE_REQUIRED");
    await db.exec("rollback to invalid_action");
    await generate("2026-09-01", "2026-09-30", otherFranchise);
    expect((await db.query("select count(*)::int as count from payroll_periods")).rows[0]).toEqual({
      count: 2,
    });
  });
  it("enforces salary read policies and prevents direct writes", async () => {
    await save();
    await actor(director);
    await save(salary, 0, otherChef);
    await actor(hr);
    await db.exec("set local role authenticated");
    expect((await db.query("select profile_id from payroll_salary_structures")).rows).toEqual([
      { profile_id: chef },
    ]);
    await db.exec("savepoint invalid_action");
    await expect(db.exec("update payroll_salary_structures set pf = 0")).rejects.toThrow(
      "permission denied",
    );
    await db.exec("rollback to invalid_action");
  });
  it("preserves paid figures through salary changes and locks the period", async () => {
    await save();
    await attendance();
    const generated = await generate();
    await db.query("select prepare_payroll_period($1)", [generated.payroll_period_id]);
    await actor(director);
    await db.query("select review_payroll_period($1)", [generated.payroll_period_id]);
    await db.query("select approve_payroll_period($1)", [generated.payroll_period_id]);
    await db.query("select mark_payroll_paid($1,'UTR-TEST-001')", [generated.payroll_period_id]);
    await db.query("select lock_payroll_period($1)", [generated.payroll_period_id]);
    await save({ ...salary, hra: 6000 }, 1);
    expect((await db.query("select net_payable,status from payroll_entries")).rows[0]).toEqual({
      net_payable: "11200.00",
      status: "paid",
    });
    await db.exec("savepoint invalid_action");
    await expect(db.exec("update payroll_entries set payable_days=30")).rejects.toThrow(
      "PAYROLL_HISTORY_IMMUTABLE",
    );
    await db.exec("rollback to invalid_action");
  });
});
