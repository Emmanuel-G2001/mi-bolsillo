import "server-only";

import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { savingsContributions, savingsGoalOperations } from "@/db/schema";

const classification = alias(savingsGoalOperations, "historical_classification");
const classificationReversal = alias(savingsGoalOperations, "historical_classification_reversal");
const original = alias(savingsGoalOperations, "original_savings_operation");

export const savingsFlowDate = sql`"savings_flow"."economic_date"`;
export const savingsFlowAmount = sql`"savings_flow"."amount"`;

// Positive amounts reserve cash. Negative amounts return reserved cash to the available balance.
export function savingsFlowForUser(userId: number) {
  return sql`(
    select ${savingsContributions.contributionDate} as economic_date, ${savingsContributions.amount} as amount
    from ${savingsContributions}
    where ${savingsContributions.userId} = ${userId}
      and not exists (
        select 1
        from ${savingsGoalOperations} as ${sql.identifier("historical_classification")}
        where ${classification.userId} = ${savingsContributions.userId}
          and ${classification.goalId} = ${savingsContributions.goalId}
          and ${classification.legacyContributionId} = ${savingsContributions.id}
          and ${classification.kind} = 'reclassify'
          and not exists (
            select 1
            from ${savingsGoalOperations} as ${sql.identifier("historical_classification_reversal")}
            where ${classificationReversal.userId} = ${classification.userId}
              and ${classificationReversal.originalOperationId} = ${classification.operationId}
              and ${classificationReversal.kind} = 'reverse'
          )
      )
    union all
    select ${savingsGoalOperations.economicDate}, case
      when ${savingsGoalOperations.kind} = 'fund' then ${savingsGoalOperations.amount}
      when ${savingsGoalOperations.kind} = 'release' then -${savingsGoalOperations.amount}
      when ${original.kind} = 'fund' then -${original.amount}
      when ${original.kind} = 'release' then ${original.amount}
    end
    from ${savingsGoalOperations}
    left join ${savingsGoalOperations} as ${sql.identifier("original_savings_operation")}
      on ${savingsGoalOperations.kind} = 'reverse'
      and ${original.userId} = ${savingsGoalOperations.userId}
      and ${original.operationId} = ${savingsGoalOperations.originalOperationId}
    where ${savingsGoalOperations.userId} = ${userId}
      and (${savingsGoalOperations.kind} in ('fund', 'release')
        or (${savingsGoalOperations.kind} = 'reverse' and ${original.kind} in ('fund', 'release')))
  ) as savings_flow`;
}
