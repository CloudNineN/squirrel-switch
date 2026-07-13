import test from "node:test";
import assert from "node:assert/strict";
import { compareAccountsByMembershipAndExpiry } from "../apps/server/dist/lib/account-sorting.js";
import { resolveSubscriptionExpiresAt, selectCodexPlanType } from "../apps/server/dist/lib/account-plan.js";
import { initialChatGptProfileName, resolvedChatGptProfileName } from "../apps/server/dist/lib/chatgpt-profile-name.js";

function account(name, planType, subscriptionExpiresAt) {
  return {
    name,
    planType,
    subscriptionPlan: null,
    subscriptionExpiresAt,
  };
}

test("Codex 账号先按会员等级、再按到期日排序", () => {
  const accounts = [
    account("Plus later", "plus", 300),
    account("Free", "free", null),
    account("Pro", "pro", 500),
    account("Plus sooner", "plus", 200),
    account("Plus unknown", "plus", null),
  ];

  accounts.sort(compareAccountsByMembershipAndExpiry);

  assert.deepEqual(
    accounts.map((item) => item.name),
    ["Pro", "Plus sooner", "Plus later", "Plus unknown", "Free"],
  );
});

test("Codex 限额响应中的计划优先于账号与令牌旧值", () => {
  assert.equal(selectCodexPlanType("free", "plus", "plus"), "free");
  assert.equal(selectCodexPlanType("unknown", "plus", "free"), "plus");
  assert.equal(selectCodexPlanType(null, "plus", "free"), "plus");
  assert.equal(selectCodexPlanType(null, null, "plus"), "plus");
});

test("Codex 刷新为 Free 后清除旧会员到期日", () => {
  assert.equal(resolveSubscriptionExpiresAt("free", 300, 200), null);
  assert.equal(resolveSubscriptionExpiresAt("Free", 300, 200), null);
  assert.equal(resolveSubscriptionExpiresAt("plus", null, 200), 200);
  assert.equal(resolveSubscriptionExpiresAt("plus", 300, 200), 300);
});

test("ChatGPT 默认使用邮箱，登录前只显示临时占位名", () => {
  assert.equal(initialChatGptProfileName(undefined, "user@example.com"), "user@example.com");
  assert.equal(initialChatGptProfileName(undefined, null), "ChatGPT");
  assert.equal(initialChatGptProfileName("个人账号", "user@example.com"), "个人账号");
});

test("ChatGPT 识别邮箱后只替换自动名称，不覆盖用户备注", () => {
  assert.equal(resolvedChatGptProfileName("ChatGPT 账号 5", null, "user@example.com"), "user@example.com");
  assert.equal(resolvedChatGptProfileName("old@example.com", "old@example.com", "new@example.com"), "new@example.com");
  assert.equal(resolvedChatGptProfileName("个人账号", null, "user@example.com"), "个人账号");
});
