// Extracted from the old inline /sandbox/company-os handler so both the
// single-agent endpoint and the orchestrator endpoint can share the same
// schema + prompt without duplication. This file is fixture code for the
// sandbox, not a general-purpose schema module.
import { z } from 'zod';

export function buildCompanyOsSchemaAndPrompt() {
  const address = z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    postalCode: z.string(),
    country: z.enum(['US', 'CA', 'UK', 'DE', 'FR', 'JP', 'AU', 'IN']),
  });

  const money = z.object({
    amount: z.number(),
    currency: z.enum(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD']),
  });

  const inputSchema = z.object({
    organization: z.object({
      id: z.string(),
      legalName: z.string(),
      dba: z.string().nullable(),
      foundedYear: z.number(),
      taxId: z.string(),
      website: z.string(),
      supportEmail: z.string(),
      mainPhone: z.string(),
      mission: z.string(),
      vision: z.string(),
      structure: z.enum([
        'llc',
        'c-corp',
        's-corp',
        'partnership',
        'non-profit',
      ]),
      headquarters: address,
      logoUrls: z.object({
        light: z.string(),
        dark: z.string(),
        mono: z.string(),
      }),
    }),

    employees: z
      .array(
        z.object({
          id: z.string(),
          firstName: z.string(),
          lastName: z.string(),
          preferredName: z.string().nullable(),
          email: z.string(),
          phone: z.string().nullable(),
          title: z.string(),
          department: z.enum([
            'engineering',
            'product',
            'design',
            'sales',
            'marketing',
            'finance',
            'operations',
            'people',
          ]),
          managerId: z.string().nullable(),
          startDate: z.string(),
          employmentType: z.enum([
            'full-time',
            'part-time',
            'contract',
            'intern',
          ]),
          status: z.enum(['active', 'on-leave', 'terminated', 'pending-start']),
          compensation: z.object({
            baseSalary: money,
            bonusTargetPercentage: z.number().nullable(),
            equityShares: z.number().nullable(),
            benefits: z.object({
              healthPlan: z.enum(['basic', 'standard', 'premium', 'opt-out']),
              vacationDays: z.number(),
              sickDays: z.number(),
              stockOptionsGranted: z.number(),
              retirementMatchPercentage: z.number(),
            }),
          }),
          location: z.object({
            office: z.enum(['hq', 'nyc', 'london', 'tokyo', 'remote']),
            remotePercentage: z.number(),
            timezone: z.string(),
            address: address.nullable(),
          }),
          profile: z.object({
            bio: z.string(),
            linkedinUrl: z.string().nullable(),
            githubUrl: z.string().nullable(),
            pronouns: z.string().nullable(),
            languagesSpoken: z.array(z.string()).meta({ count: 3 }),
            hobbies: z.array(z.string()),
          }),
          emergencyContacts: z
            .array(
              z.object({
                name: z.string(),
                relationship: z.enum([
                  'spouse',
                  'parent',
                  'sibling',
                  'child',
                  'friend',
                  'other',
                ]),
                phone: z.string(),
                email: z.string().nullable(),
                primary: z.boolean(),
              })
            )
            .meta({ count: 2 }),
          certifications: z
            .array(
              z.object({
                name: z.string(),
                issuingOrg: z.string(),
                issueDate: z.string(),
                expirationDate: z.string().nullable(),
                credentialId: z.string(),
              })
            )
            .meta({ count: 2 }),
        })
      )
      .meta({ count: 5 }),

    projects: z
      .array(
        z.object({
          id: z.string(),
          code: z.string(),
          name: z.string(),
          description: z.string(),
          status: z.enum([
            'proposed',
            'planning',
            'in-progress',
            'paused',
            'completed',
            'cancelled',
          ]),
          priority: z.enum(['low', 'medium', 'high', 'critical']),
          phase: z.enum([
            'discovery',
            'design',
            'build',
            'launch',
            'maintenance',
          ]),
          startDate: z.string(),
          targetEndDate: z.string(),
          actualEndDate: z.string().nullable(),
          budget: money,
          actualSpend: money,
          confidenceLevel: z.enum(['low', 'medium', 'high']),
          ownerId: z.string(),
          sponsorId: z.string(),
          clientId: z.string().nullable(),
          tags: z.array(z.string()).meta({ count: 4 }),
          milestones: z
            .array(
              z.object({
                id: z.string(),
                name: z.string(),
                description: z.string(),
                targetDate: z.string(),
                actualDate: z.string().nullable(),
                status: z.enum([
                  'pending',
                  'in-progress',
                  'complete',
                  'missed',
                ]),
                deliverables: z.array(z.string()),
                acceptanceCriteria: z.array(z.string()),
              })
            )
            .meta({ count: 3 }),
          tasks: z
            .array(
              z.object({
                id: z.string(),
                title: z.string(),
                description: z.string(),
                status: z.enum([
                  'backlog',
                  'todo',
                  'in-progress',
                  'in-review',
                  'done',
                  'cancelled',
                ]),
                priority: z.enum(['low', 'medium', 'high', 'urgent']),
                type: z.enum(['feature', 'bug', 'chore', 'spike', 'incident']),
                assigneeId: z.string().nullable(),
                reporterId: z.string(),
                estimateHours: z.number(),
                actualHours: z.number().nullable(),
                createdAt: z.string(),
                updatedAt: z.string(),
                completedAt: z.string().nullable(),
                labels: z.array(z.string()),
                dependencies: z.array(z.string()),
                subtasks: z
                  .array(
                    z.object({
                      id: z.string(),
                      title: z.string(),
                      done: z.boolean(),
                      estimateHours: z.number(),
                      actualHours: z.number().nullable(),
                    })
                  )
                  .meta({ count: 2 }),
                comments: z
                  .array(
                    z.object({
                      id: z.string(),
                      authorId: z.string(),
                      createdAt: z.string(),
                      body: z.string(),
                      edited: z.boolean(),
                    })
                  )
                  .meta({ count: 2 }),
              })
            )
            .meta({ count: 3 }),
          risks: z
            .array(
              z.object({
                id: z.string(),
                description: z.string(),
                category: z.enum([
                  'technical',
                  'schedule',
                  'budget',
                  'scope',
                  'resource',
                  'external',
                ]),
                probability: z.enum([
                  'unlikely',
                  'possible',
                  'likely',
                  'almost-certain',
                ]),
                impact: z.enum([
                  'negligible',
                  'minor',
                  'moderate',
                  'major',
                  'severe',
                ]),
                mitigation: z.string(),
                ownerId: z.string(),
                dueDate: z.string(),
              })
            )
            .meta({ count: 2 }),
        })
      )
      .meta({ count: 3 }),

    clients: z
      .array(
        z.object({
          id: z.string(),
          legalName: z.string(),
          tier: z.enum(['platinum', 'gold', 'silver', 'bronze', 'trial']),
          industry: z.string(),
          website: z.string(),
          accountManagerId: z.string(),
          headquarters: address,
          primaryContact: z.object({
            name: z.string(),
            title: z.string(),
            email: z.string(),
            phone: z.string(),
          }),
          secondaryContacts: z
            .array(
              z.object({
                name: z.string(),
                title: z.string(),
                email: z.string(),
                phone: z.string().nullable(),
                department: z.string(),
              })
            )
            .meta({ count: 2 }),
          contracts: z
            .array(
              z.object({
                id: z.string(),
                type: z.enum(['msa', 'sow', 'nda', 'license', 'retainer']),
                title: z.string(),
                startDate: z.string(),
                endDate: z.string(),
                totalValue: money,
                autoRenew: z.boolean(),
                renewalTerms: z.string().nullable(),
                keyTerms: z.array(z.string()),
                paymentSchedule: z
                  .array(
                    z.object({
                      id: z.string(),
                      amount: money,
                      dueDate: z.string(),
                      paidDate: z.string().nullable(),
                      invoiceNumber: z.string(),
                      status: z.enum([
                        'scheduled',
                        'sent',
                        'paid',
                        'overdue',
                        'disputed',
                      ]),
                    })
                  )
                  .meta({ count: 3 }),
              })
            )
            .meta({ count: 2 }),
        })
      )
      .meta({ count: 3 }),

    meetings: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          scheduledAt: z.string(),
          durationMinutes: z.number(),
          location: z.enum(['in-person', 'video', 'phone', 'hybrid']),
          organizerId: z.string(),
          status: z.enum([
            'scheduled',
            'completed',
            'cancelled',
            'rescheduled',
          ]),
          relatedProjectId: z.string().nullable(),
          agenda: z.array(z.string()),
          attendeeIds: z.array(z.string()).meta({ count: 4 }),
          actionItems: z
            .array(
              z.object({
                description: z.string(),
                ownerId: z.string(),
                dueDate: z.string().nullable(),
                status: z.enum(['open', 'in-progress', 'done']),
              })
            )
            .meta({ count: 3 }),
        })
      )
      .meta({ count: 4 }),

    generatedAt: z.string(),
    reportPeriodStart: z.string(),
    reportPeriodEnd: z.string(),
    totalActiveEmployees: z.number(),
    totalOpenProjects: z.number(),
    totalActiveClients: z.number(),
    quarterlyRevenueUsd: z.number(),
    quarterlyExpensesUsd: z.number(),
  });

  const prompt = `Create a company operations overview page — a quarterly briefing that an executive could scan in a few minutes to understand the state of the business.

**Header**
- Organization name (organization.legalName, with dba as a subtle subtitle if present) and mission
- Report period (format reportPeriodStart and reportPeriodEnd as a readable range)
- Four headline KPIs in a compact row: totalActiveEmployees, totalOpenProjects, totalActiveClients, and quarterly net (quarterlyRevenueUsd − quarterlyExpensesUsd shown with revenue and expenses as context)

**People** (section)
- A roster of employees grouped or sorted by department — show name (preferredName or firstName + lastName), title, department, office location, and status
- Surface on-leave and pending-start statuses visibly (badge or accent) — don't hide them in small text
- Keep each row compact; this is a directory, not a profile page

**Projects** (section — the most detail-rich section)
- One block per project. Show: code + name, status, priority, phase, confidence level, owner, date range, budget vs actual spend (visual treatment showing over/under budget)
- Nested: milestones as a compact list with status indicators, tasks as a compact list with status + assignee, and risks with probability/impact signals
- Give critical priority or high-severity risks visual weight

**Clients** (section)
- One block per client. Show: legal name, tier (visually distinguish platinum/gold/silver/bronze), industry, account manager, primary contact
- Contracts as a compact sub-list per client — type, title, value, date range, autoRenew indicator
- Payment schedule rollup per contract — just totals and count of overdue/disputed payments; don't enumerate every single payment line

**Meetings** (section)
- Upcoming and recent meetings grouped by status
- Show: title, scheduled time, duration, location mode, organizer, related project (if any)
- Action items as a compact sub-list with status + owner

The page is read-only — no forms, no buttons, no checkboxes. Think internal quarterly report: dense enough to be informative, visual enough to scan. Prioritize typographic hierarchy and whitespace over heavy card borders. Don't reflexively wrap every item in a bordered card — a stack of dozens of identical bordered boxes is almost always the wrong choice. Separators, headings, and spacing do most of the work.`;

  return { inputSchema, prompt };
}
