import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import OrganizationUserSetup from "./OrganizationUserSetup";
import OrganizationKnowledge from "./OrganizationKnowledge";
import OrganizationDataAi from "./OrganizationDataAi";
import OrganizationBillingManager from "./OrganizationBillingManager";

type DashboardView =
  | "overview"
  | "users"
  | "groups"
  | "billing"
  | "reports" | "analyze"
  | "knowledge"
  | "settings";

type OrganizationDashboardProps = {
  organizationId: string;
  organizationName: string;
  role: string;
  billingAccessEnabled: boolean;
  subscriptionStatus: string;
  missionStatement: string;
  visionStatement: string;
  valuesStatement: string;
  accountEmail: string;
  onSignOut: () => Promise<void>;
};

type SeatSummary = {
  purchasedSeatCount: number;
  usedSeatCount: number;
  availableSeatCount: number;
};

type OrganizationGroup = {
  id: string;
  name: string;
  parent_group_id: string | null;
};

type OrganizationDirectoryUser = {
  organization_user_id: string;
  user_id: string;
  full_name: string;
  email_address: string;
  organization_role: string;
  is_active: boolean;
  is_billable: boolean;
  primary_group_id: string | null;
  primary_group_name: string | null;
  manager_portal_access_enabled: boolean;
  billing_access_enabled: boolean;
  manager_portal_access_mode: string;
  is_organization_owner: boolean;
};

type OrganizationRole =
  | "organization_admin"
  | "billing_admin"
  | "user_admin"
  | "group_manager"
  | "view_only"
  | "member";

type UserStatusFilter = "all" | "active" | "inactive";

type UserAccessFilter = "all" | "app_access" | "portal_access" | "no_access";

type OrganizationUsageReport = {
  selected_user_count: number;
  priority_count: number;
  decision_count: number;
  trackable_count: number;
  ai_credits_used: number;
};

type OrganizationAiCreditSummary = {
  ai_credits_available: number;
  ai_credits_used: number;
  ai_credit_period_start: string | null;
  ai_credit_renewal_date: string | null;
};

type OrganizationPortalCreditSummary = {
  portal_credits_available: number;
  portal_credits_used: number;
  portal_credit_period_start: string | null;
  portal_credit_renewal_date: string | null;
};

type GenerateOrganizationMvvResponse = {
  missionStatement?: string;
  visionStatement?: string;
  valuesStatement?: string;
  portalCreditsAvailable?: number;
  portalCreditsUsed?: number;
  portalCreditRenewalDate?: string | null;
  portalCreditCost?: number;
  error?: string;
};

type OrganizationComparisonReportRow = {
  id: string;
  name: string;
  selected_user_count: number;
  priority_count: number;
  decision_count: number;
  trackable_count: number;
  ai_credits_used: number;
};

type PriorityDecisionReportItem = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  created_at: string | null;
};

type PriorityTrackableReportItem = {
  id: string;
  title: string;
  description: string | null;
  unit: string | null;
  status: string;
  created_at: string | null;
  better_when: string | null;
  retired_at: string | null;
  completed_at: string | null;
};

type TrackableEntryExportItem = {
  trackable_id: string;
  entry_id: string;
  entry_value: string;
  entry_note: string;
  entry_recorded_at: string | null;
  entry_status: string;
};

type DecisionAnalysisExportItem = {
  analysis_id: string;
  decision_id: string;
  analysis_type: string;
  analysis_label: string;
  analysis_summary: string;
  alignment_signal: string;
  priority_alignment: string;
  risk_tradeoff: string;
  better_next_decision: string;
  suggested_trackable: string;
  next_step: string;
  analysis_note: string;
  insight_level: string;
  decision_pattern_read: string;
  priority_pressure: string;
  execution_risk: string;
  highest_leverage_followup: string;
  evidence_quality: string;
  credits_used: number;
  analysis_created_at: string | null;
};

type OrganizationPriorityDetailReport = {
  priority_id: string;
  user_id: string;
  user_full_name: string;
  user_email: string;
  group_id: string | null;
  group_name: string | null;
  priority_title: string;
  priority_description: string | null;
  priority_status: string;
  priority_created_at: string | null;
  priority_completed_at: string | null;
  priority_retired_at: string | null;
  decisions: PriorityDecisionReportItem[];
  trackables: PriorityTrackableReportItem[];
};

const roleOptions: Array<{
  value: OrganizationRole;
  label: string;
}> = [
  {
    value: "member",
    label: "Employee",
  },
  {
    value: "group_manager",
    label: "Group Manager",
  },
  {
    value: "view_only",
    label: "View Only",
  },
  {
    value: "user_admin",
    label: "User Admin",
  },
  {
    value: "billing_admin",
    label: "Billing Admin",
  },
  {
    value: "organization_admin",
    label: "Organization Admin",
  },
];

function formatRole(role: string) {
  if (role === "member") {
    return "Employee";
  }

  return role
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatReportDate(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function escapeCsvValue(value: unknown) {
  const normalizedValue =
    value === null || value === undefined ? "" : String(value);

  return `"${normalizedValue.replaceAll('"', '""')}"`;
}

function downloadCsvFile(
  filename: string,
  headers: string[],
  rows: unknown[][],
) {
  const csvContent = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ].join("\n");

  const csvBlob = new Blob([`\uFEFF${csvContent}`], {
    type: "text/csv;charset=utf-8",
  });

  const downloadUrl = URL.createObjectURL(csvBlob);
  const downloadLink = document.createElement("a");

  downloadLink.href = downloadUrl;
  downloadLink.download = filename;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(downloadUrl);
}

function hasPortalAccess(user: OrganizationDirectoryUser) {
  if (!user.is_active) {
    return false;
  }

  if (user.billing_access_enabled) {
    return true;
  }

  if (
    user.organization_role === "organization_admin" ||
    user.organization_role === "billing_admin" ||
    user.organization_role === "user_admin" ||
    user.organization_role === "view_only"
  ) {
    return true;
  }

  return (
    user.organization_role === "group_manager" &&
    user.manager_portal_access_enabled
  );
}

type OrganizationGroupHierarchyItem = OrganizationGroup & {
  depth: number;
};

function buildGroupHierarchy(
  groups: OrganizationGroup[],
): OrganizationGroupHierarchyItem[] {
  const orderedGroups: OrganizationGroupHierarchyItem[] = [];
  const includedGroupIds = new Set<string>();

  function addGroupAndChildren(group: OrganizationGroup, depth: number) {
    if (includedGroupIds.has(group.id)) {
      return;
    }

    includedGroupIds.add(group.id);
    orderedGroups.push({
      ...group,
      depth,
    });

    groups
      .filter((possibleChild) => possibleChild.parent_group_id === group.id)
      .sort((firstGroup, secondGroup) =>
        firstGroup.name.localeCompare(secondGroup.name),
      )
      .forEach((childGroup) => {
        addGroupAndChildren(childGroup, depth + 1);
      });
  }

  groups
    .filter((group) => !group.parent_group_id)
    .sort((firstGroup, secondGroup) =>
      firstGroup.name.localeCompare(secondGroup.name),
    )
    .forEach((rootGroup) => {
      addGroupAndChildren(rootGroup, 0);
    });

  groups
    .filter((group) => !includedGroupIds.has(group.id))
    .sort((firstGroup, secondGroup) =>
      firstGroup.name.localeCompare(secondGroup.name),
    )
    .forEach((unlinkedGroup) => {
      addGroupAndChildren(unlinkedGroup, 0);
    });

  return orderedGroups;
}

function getDefaultExpandedGroupIds(
  groups: OrganizationGroup[],
  currentUser: OrganizationDirectoryUser | undefined,
) {
  const expandedGroupIds = new Set<string>();

  if (
    !currentUser ||
    !hasPortalAccess(currentUser) ||
    !currentUser.primary_group_id
  ) {
    groups
      .filter((group) => !group.parent_group_id)
      .forEach((group) => {
        expandedGroupIds.add(group.id);
      });

    return expandedGroupIds;
  }

  let currentGroupId: string | null = currentUser.primary_group_id;

  const visitedGroupIds = new Set<string>();

  while (currentGroupId && !visitedGroupIds.has(currentGroupId)) {
    visitedGroupIds.add(currentGroupId);

    const currentGroup = groups.find((group) => group.id === currentGroupId);

    if (!currentGroup?.parent_group_id) {
      break;
    }

    expandedGroupIds.add(currentGroup.parent_group_id);
    currentGroupId = currentGroup.parent_group_id;
  }

  return expandedGroupIds;
}

function getVisibleGroupHierarchy(
  groups: OrganizationGroup[],
  expandedGroupIds: Set<string>,
) {
  return buildGroupHierarchy(groups).filter((group) => {
    if (!group.parent_group_id) {
      return true;
    }

    let parentGroupId: string | null = group.parent_group_id;

    const visitedGroupIds = new Set<string>();

    while (parentGroupId && !visitedGroupIds.has(parentGroupId)) {
      visitedGroupIds.add(parentGroupId);

      if (!expandedGroupIds.has(parentGroupId)) {
        return false;
      }

      const parentGroup = groups.find(
        (possibleParent) => possibleParent.id === parentGroupId,
      );

      parentGroupId = parentGroup?.parent_group_id ?? null;
    }

    return true;
  });
}

function OrganizationDashboard({
  organizationId,
  organizationName,
  role,
  billingAccessEnabled,
  subscriptionStatus,
  missionStatement,
  visionStatement,
  valuesStatement,
  accountEmail,
  onSignOut,
}: OrganizationDashboardProps) {
  const [activeView, setActiveView] = useState<DashboardView>("overview");
  const [isAddingUsers, setIsAddingUsers] = useState(false);

  const [currentOrganizationName, setCurrentOrganizationName] =
    useState(organizationName);
  const [currentMissionStatement, setCurrentMissionStatement] =
    useState(missionStatement);
  const [currentVisionStatement, setCurrentVisionStatement] =
    useState(visionStatement);
  const [currentValuesStatement, setCurrentValuesStatement] =
    useState(valuesStatement);

  const [settingsOrganizationName, setSettingsOrganizationName] =
    useState(organizationName);
  const [settingsMissionStatement, setSettingsMissionStatement] =
    useState(missionStatement);
  const [settingsVisionStatement, setSettingsVisionStatement] =
    useState(visionStatement);
  const [settingsValuesStatement, setSettingsValuesStatement] =
    useState(valuesStatement);
  const [settingsManagerPortalAccessMode, setSettingsManagerPortalAccessMode] =
    useState("disabled");
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");

  const [organizationPortalCreditSummary, setOrganizationPortalCreditSummary] =
    useState<OrganizationPortalCreditSummary | null>(null);
  const [
    isLoadingOrganizationPortalCredits,
    setIsLoadingOrganizationPortalCredits,
  ] = useState(false);
  const [organizationPortalCreditMessage, setOrganizationPortalCreditMessage] =
    useState("");

  const [mvvOrganizationPurpose, setMvvOrganizationPurpose] = useState("");
  const [mvvCustomersServed, setMvvCustomersServed] = useState("");
  const [mvvProductsOrServices, setMvvProductsOrServices] = useState("");
  const [mvvFutureDirection, setMvvFutureDirection] = useState("");
  const [mvvOperatingPrinciples, setMvvOperatingPrinciples] = useState("");
  const [isGeneratingMvv, setIsGeneratingMvv] = useState(false);
  const [mvvGenerationMessage, setMvvGenerationMessage] = useState("");

  const [seatSummary, setSeatSummary] = useState<SeatSummary>({
    purchasedSeatCount: 0,
    usedSeatCount: 0,
    availableSeatCount: 0,
  });
  const [isLoadingSeats, setIsLoadingSeats] = useState(true);
  const [seatMessage, setSeatMessage] = useState("");

  const [organizationUsers, setOrganizationUsers] = useState<
    OrganizationDirectoryUser[]
  >([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [userDirectoryMessage, setUserDirectoryMessage] = useState("");
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userStatusFilter, setUserStatusFilter] =
    useState<UserStatusFilter>("all");
  const [userAccessFilter, setUserAccessFilter] =
    useState<UserAccessFilter>("all");

  const [organizationGroups, setOrganizationGroups] = useState<
    OrganizationGroup[]
  >([]);
  const [groupMessage, setGroupMessage] = useState("");
  const [groupSearchQuery, setGroupSearchQuery] = useState("");
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    new Set(),
  );
  const [hasInitializedGroupExpansion, setHasInitializedGroupExpansion] =
    useState(false);

  const [selectedUser, setSelectedUser] =
    useState<OrganizationDirectoryUser | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<OrganizationRole>("member");
  const [editPrimaryGroupId, setEditPrimaryGroupId] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editIsBillable, setEditIsBillable] = useState(true);
  const [editBillingAccessEnabled, setEditBillingAccessEnabled] =
    useState(false);
  const [editManagerPortalAccessEnabled, setEditManagerPortalAccessEnabled] =
    useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [editUserMessage, setEditUserMessage] = useState("");

  const [selectedReportUserIds, setSelectedReportUserIds] = useState<
    Set<string>
  >(new Set());
  const [selectedReportGroupIds, setSelectedReportGroupIds] = useState<
    Set<string>
  >(new Set());
  const [usageReport, setUsageReport] =
    useState<OrganizationUsageReport | null>(null);
  const [organizationAiCreditSummary, setOrganizationAiCreditSummary] =
    useState<OrganizationAiCreditSummary | null>(null);
  const [isLoadingOrganizationAiCredits, setIsLoadingOrganizationAiCredits] =
    useState(false);
  const [organizationAiCreditMessage, setOrganizationAiCreditMessage] =
    useState("");
  const [activePriorityReport, setActivePriorityReport] = useState<
    OrganizationPriorityDetailReport[]
  >([]);
  const [retiredPriorityReport, setRetiredPriorityReport] = useState<
    OrganizationPriorityDetailReport[]
  >([]);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [hasLoadedReports, setHasLoadedReports] = useState(false);
  const [reportMessage, setReportMessage] = useState("");
  const [reportDetailSearchQuery, setReportDetailSearchQuery] = useState("");
  const [comparisonReportRows, setComparisonReportRows] = useState<
    OrganizationComparisonReportRow[]
  >([]);
  const [trackableEntriesByTrackableId, setTrackableEntriesByTrackableId] =
    useState<Record<string, TrackableEntryExportItem[]>>({});
  const [decisionAnalysesByDecisionId, setDecisionAnalysesByDecisionId] =
    useState<Record<string, DecisionAnalysisExportItem[]>>({});

  const hasOrganizationFoundation =
    Boolean(currentMissionStatement.trim()) ||
    Boolean(currentVisionStatement.trim()) ||
    Boolean(currentValuesStatement.trim());

  const normalizedUserSearchQuery = userSearchQuery.trim().toLowerCase();

  const filteredOrganizationUsers = organizationUsers.filter((user) => {
    const matchesSearch =
      !normalizedUserSearchQuery ||
      user.full_name.toLowerCase().includes(normalizedUserSearchQuery) ||
      user.email_address.toLowerCase().includes(normalizedUserSearchQuery) ||
      formatRole(user.organization_role)
        .toLowerCase()
        .includes(normalizedUserSearchQuery) ||
      (user.primary_group_name ?? "")
        .toLowerCase()
        .includes(normalizedUserSearchQuery);

    const matchesStatus =
      userStatusFilter === "all" ||
      (userStatusFilter === "active" && user.is_active) ||
      (userStatusFilter === "inactive" && !user.is_active);

    const userHasPortalAccess = hasPortalAccess(user);

    const matchesAccess =
      userAccessFilter === "all" ||
      (userAccessFilter === "app_access" &&
        user.is_active &&
        user.is_billable) ||
      (userAccessFilter === "portal_access" && userHasPortalAccess) ||
      (userAccessFilter === "no_access" &&
        (!user.is_active || (!user.is_billable && !userHasPortalAccess)));

    return matchesSearch && matchesStatus && matchesAccess;
  });

  const currentDirectoryUser = organizationUsers.find(
    (user) =>
      user.email_address.trim().toLowerCase() ===
      accountEmail.trim().toLowerCase(),
  );

  const visibleOrganizationGroupHierarchy = getVisibleGroupHierarchy(
    organizationGroups,
    expandedGroupIds,
  );

  const normalizedGroupSearchQuery = groupSearchQuery.trim().toLowerCase();

  const directlyMatchingGroupIds = new Set(
    organizationGroups
      .filter((group) => {
        return (
          !normalizedGroupSearchQuery ||
          group.name.toLowerCase().includes(normalizedGroupSearchQuery)
        );
      })
      .map((group) => group.id),
  );

  const matchingGroupAndAncestorIds = new Set<string>();

  directlyMatchingGroupIds.forEach((groupId) => {
    let currentGroupId: string | null = groupId;
    const visitedGroupIds = new Set<string>();

    while (currentGroupId && !visitedGroupIds.has(currentGroupId)) {
      visitedGroupIds.add(currentGroupId);
      matchingGroupAndAncestorIds.add(currentGroupId);

      const currentGroup = organizationGroups.find(
        (group) => group.id === currentGroupId,
      );

      currentGroupId = currentGroup?.parent_group_id ?? null;
    }
  });

  const organizationGroupHierarchy = !normalizedGroupSearchQuery
    ? visibleOrganizationGroupHierarchy
    : buildGroupHierarchy(organizationGroups).filter((group) =>
        matchingGroupAndAncestorIds.has(group.id),
      );

  const rootGroupCount = organizationGroups.filter(
    (group) => !group.parent_group_id,
  ).length;

  const assignedGroupCount = new Set(
    organizationUsers
      .filter(
        (user) => user.is_active && user.is_billable && user.primary_group_id,
      )
      .map((user) => user.primary_group_id),
  ).size;

  const reportableOrganizationUsers = organizationUsers
    .filter((user) => user.is_active && user.is_billable)
    .sort((firstUser, secondUser) =>
      firstUser.full_name.localeCompare(secondUser.full_name),
    );

  const reportGroupHierarchy = buildGroupHierarchy(organizationGroups);

  const isIndividualReportMode = selectedReportUserIds.size > 0;

  const isGroupReportMode = selectedReportGroupIds.size > 0;

  const showComparisonMatrix =
    selectedReportUserIds.size > 1 || selectedReportGroupIds.size > 1;

  const selectedReportUserNames = reportableOrganizationUsers
    .filter((user) => selectedReportUserIds.has(user.user_id))
    .map((user) => user.full_name.trim())
    .filter(Boolean);

  const selectedReportGroupNames = organizationGroups
    .filter((group) => selectedReportGroupIds.has(group.id))
    .map((group) => group.name.trim())
    .filter(Boolean)
    .sort((firstName, secondName) =>
      firstName.localeCompare(secondName),
    );

  const reportScopeLabel =
    selectedReportUserNames.length === 0 &&
    selectedReportGroupNames.length === 0
      ? "Whole organization"
      : selectedReportUserNames.length > 0
        ? `${
            selectedReportUserNames.length === 1
              ? "Individual"
              : "Individuals"
          }: ${selectedReportUserNames.join(", ")}`
        : `${
            selectedReportGroupNames.length === 1
              ? "Group"
              : "Groups"
          }: ${selectedReportGroupNames.join(", ")}`;

  const normalizedReportDetailSearchQuery = reportDetailSearchQuery
    .trim()
    .toLowerCase();

  function fieldsMatchDetailSearch(
    fields: Array<string | number | null | undefined>,
  ) {
    if (!normalizedReportDetailSearchQuery) {
      return true;
    }

    return fields.some((field) =>
      String(field ?? "")
        .toLowerCase()
        .includes(normalizedReportDetailSearchQuery),
    );
  }

  function analysisMatchesDetailSearch(analysis: DecisionAnalysisExportItem) {
    return fieldsMatchDetailSearch([
      analysis.analysis_type,
      analysis.analysis_label,
      analysis.analysis_summary,
      analysis.alignment_signal,
      analysis.priority_alignment,
      analysis.risk_tradeoff,
      analysis.better_next_decision,
      analysis.suggested_trackable,
      analysis.next_step,
      analysis.analysis_note,
      analysis.insight_level,
      analysis.decision_pattern_read,
      analysis.priority_pressure,
      analysis.execution_risk,
      analysis.highest_leverage_followup,
      analysis.evidence_quality,
    ]);
  }

  function decisionMatchesDetailSearch(decision: PriorityDecisionReportItem) {
    return (
      fieldsMatchDetailSearch([
        decision.title,
        decision.description,
        decision.status,
      ]) ||
      (decisionAnalysesByDecisionId[decision.id] ?? []).some(
        analysisMatchesDetailSearch,
      )
    );
  }

  function entryMatchesDetailSearch(entry: TrackableEntryExportItem) {
    return fieldsMatchDetailSearch([
      entry.entry_value,
      entry.entry_note,
      entry.entry_status,
    ]);
  }

  function trackableMatchesDetailSearch(
    trackable: PriorityTrackableReportItem,
  ) {
    return (
      fieldsMatchDetailSearch([
        trackable.title,
        trackable.description,
        trackable.unit,
        trackable.status,
        trackable.better_when,
      ]) ||
      (trackableEntriesByTrackableId[trackable.id] ?? []).some(
        entryMatchesDetailSearch,
      )
    );
  }

  function priorityMatchesDetailSearch(
    priority: OrganizationPriorityDetailReport,
  ) {
    return (
      fieldsMatchDetailSearch([
        priority.user_full_name,
        priority.user_email,
        priority.group_name,
        priority.priority_title,
        priority.priority_description,
        priority.priority_status,
      ]) ||
      priority.decisions.some(decisionMatchesDetailSearch) ||
      priority.trackables.some(trackableMatchesDetailSearch)
    );
  }

  const filteredActivePriorityReport = activePriorityReport.filter(
    priorityMatchesDetailSearch,
  );

  const filteredRetiredPriorityReport = retiredPriorityReport.filter(
    priorityMatchesDetailSearch,
  );

  const loadDashboardData = useCallback(async () => {
    setIsLoadingSeats(true);
    setIsLoadingUsers(true);
    setSeatMessage("");
    setUserDirectoryMessage("");
    setGroupMessage("");

    if (!organizationId) {
      setSeatMessage("Unable to load current seat information.");
      setUserDirectoryMessage("Unable to load organization users.");
      setGroupMessage("Unable to load organization groups.");
      setIsLoadingSeats(false);
      setIsLoadingUsers(false);
      return;
    }

    const canViewSeatSummary =
      role === "organization_admin" ||
      role === "billing_admin" ||
      billingAccessEnabled;

    const canLoadOrganizationDirectory =
      role !== "billing_admin" && role !== "member";

    const [seatSummaryResult, userDirectoryResult, organizationGroupsResult] =
      await Promise.all([
        canViewSeatSummary
          ? supabase.rpc("get_organization_seat_summary", {
              p_organization_id: organizationId,
            })
          : Promise.resolve({
              data: null,
              error: null,
            }),
        canLoadOrganizationDirectory
          ? supabase.rpc("get_organization_user_directory", {
              p_organization_id: organizationId,
            })
          : Promise.resolve({
              data: [],
              error: null,
            }),
        canLoadOrganizationDirectory
          ? supabase.rpc("get_organization_visible_groups", {
              p_organization_id: organizationId,
            })
          : Promise.resolve({
              data: [],
              error: null,
            }),
      ]);

    if (canViewSeatSummary) {
      if (seatSummaryResult.error) {
        console.error(
          "Organization seat summary failed to load:",
          seatSummaryResult.error,
        );
        setSeatMessage("Unable to load current seat information.");
      } else {
        const summary = seatSummaryResult.data?.[0];

        if (!summary) {
          setSeatMessage("Unable to load current seat information.");
        } else {
          setSeatSummary({
            purchasedSeatCount: Math.max(
              0,
              Number(summary.purchased_seat_count ?? 0),
            ),
            usedSeatCount: Math.max(0, Number(summary.used_seat_count ?? 0)),
            availableSeatCount: Math.max(
              0,
              Number(summary.available_seat_count ?? 0),
            ),
          });
        }
      }
    }

    if (userDirectoryResult.error) {
      console.error(
        "Organization user directory failed to load:",
        userDirectoryResult.error,
      );
      setUserDirectoryMessage("Unable to load organization users.");
    } else {
      setOrganizationUsers(
        (userDirectoryResult.data ?? []) as OrganizationDirectoryUser[],
      );
    }

    if (organizationGroupsResult.error) {
      console.error(
        "Organization groups failed to load:",
        organizationGroupsResult.error,
      );
      setGroupMessage("Unable to load organization groups.");
    } else {
      setOrganizationGroups(
        (organizationGroupsResult.data ?? []).map(
          (group: {
            group_id: string;
            group_name: string;
            parent_group_id: string | null;
          }) => ({
            id: group.group_id,
            name: group.group_name,
            parent_group_id: group.parent_group_id,
          }),
        ) as OrganizationGroup[],
      );
    }

    setIsLoadingSeats(false);
    setIsLoadingUsers(false);
  }, [billingAccessEnabled, organizationId, role]);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  useEffect(() => {
    setExpandedGroupIds(new Set());
    setHasInitializedGroupExpansion(false);
    setSelectedReportUserIds(new Set());
    setSelectedReportGroupIds(new Set());
    setUsageReport(null);
    setActivePriorityReport([]);
    setRetiredPriorityReport([]);
    setTrackableEntriesByTrackableId({});
    setDecisionAnalysesByDecisionId({});
    setHasLoadedReports(false);
    setReportMessage("");
    setReportDetailSearchQuery("");
  }, [organizationId]);

  useEffect(() => {
    if (
      hasInitializedGroupExpansion ||
      organizationGroups.length === 0 ||
      organizationUsers.length === 0
    ) {
      return;
    }

    setExpandedGroupIds(
      getDefaultExpandedGroupIds(organizationGroups, currentDirectoryUser),
    );

    setHasInitializedGroupExpansion(true);
  }, [
    currentDirectoryUser,
    hasInitializedGroupExpansion,
    organizationGroups,
    organizationUsers.length,
  ]);

  const canManageUsers = role === "organization_admin" || role === "user_admin";

  const canManageGroups =
    role === "organization_admin" || role === "user_admin";

  const canViewBilling =
    role === "organization_admin" ||
    role === "billing_admin" ||
    billingAccessEnabled;

  const canViewReports =
    role === "organization_admin" ||
    role === "user_admin" ||
    role === "group_manager" ||
    role === "view_only";

  const canViewCompanyKnowledge =
    role === "organization_admin" ||
    role === "user_admin" ||
    role === "group_manager" ||
    role === "view_only";

  const canManageOrganizationSettings = role === "organization_admin";

  function openView(view: DashboardView) {
    if (view === "users" && !canManageUsers) {
      return;
    }

    if (view === "groups" && !canManageGroups) {
      return;
    }

    if (view === "billing" && !canViewBilling) {
      return;
    }

    if (view === "reports" && !canViewReports) {
      return;
    }

    if (view === "knowledge" && !canViewCompanyKnowledge) {
      return;
    }

    if (view === "settings" && !canManageOrganizationSettings) {
      return;
    }

    setActiveView(view);
    setIsAddingUsers(false);
    setSelectedUser(null);
    setEditUserMessage("");

    if (view === "reports") {
      void loadOrganizationAiCreditSummary();
    }

    if (view === "settings") {
      void loadOrganizationSettings();
      void loadOrganizationPortalCreditSummary();
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openUserEditor(user: OrganizationDirectoryUser) {
    setSelectedUser(user);
    setEditFullName(user.full_name);
    setEditEmail(user.email_address);
    setEditPassword("");
    setEditRole(user.organization_role as OrganizationRole);
    setEditPrimaryGroupId(
      user.is_billable ? (user.primary_group_id ?? "") : "",
    );
    setEditIsActive(user.is_active);
    setEditIsBillable(user.is_billable);
    setEditBillingAccessEnabled(user.billing_access_enabled);
    setEditManagerPortalAccessEnabled(user.manager_portal_access_enabled);
    setEditUserMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeUserEditor() {
    setSelectedUser(null);
    setEditUserMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleGroupExpansion(groupId: string) {
    setExpandedGroupIds((currentExpandedGroupIds) => {
      const nextExpandedGroupIds = new Set(currentExpandedGroupIds);

      if (nextExpandedGroupIds.has(groupId)) {
        nextExpandedGroupIds.delete(groupId);
      } else {
        nextExpandedGroupIds.add(groupId);
      }

      return nextExpandedGroupIds;
    });
  }

  function toggleReportUser(userId: string) {
    setSelectedReportGroupIds(new Set());

    setSelectedReportUserIds((currentUserIds) => {
      const nextUserIds = new Set(currentUserIds);

      if (nextUserIds.has(userId)) {
        nextUserIds.delete(userId);
      } else {
        nextUserIds.add(userId);
      }

      return nextUserIds;
    });

    setComparisonReportRows([]);
    setHasLoadedReports(false);
    setReportMessage("");
  }

  function toggleReportGroup(groupId: string) {
    setSelectedReportUserIds(new Set());

    setSelectedReportGroupIds((currentGroupIds) => {
      const nextGroupIds = new Set(currentGroupIds);

      if (nextGroupIds.has(groupId)) {
        nextGroupIds.delete(groupId);
      } else {
        nextGroupIds.add(groupId);
      }

      return nextGroupIds;
    });

    setComparisonReportRows([]);
    setHasLoadedReports(false);
    setReportMessage("");
  }

  function selectWholeOrganizationReport() {
    setSelectedReportUserIds(new Set());
    setSelectedReportGroupIds(new Set());
    setComparisonReportRows([]);
    setHasLoadedReports(false);
    setReportMessage("");
  }

  async function loadOrganizationSettings() {
    if (!organizationId) {
      setSettingsMessage("Unable to load organization settings.");
      return;
    }

    setIsLoadingSettings(true);
    setSettingsMessage("");

    const { data, error } = await supabase.rpc("get_organization_settings", {
      p_organization_id: organizationId,
    });

    if (error) {
      console.error("Organization settings failed to load:", error);
      setSettingsMessage(
        error.message || "Unable to load organization settings.",
      );
      setIsLoadingSettings(false);
      return;
    }

    const settings = data?.[0];

    if (!settings) {
      setSettingsMessage("No organization settings were found.");
      setIsLoadingSettings(false);
      return;
    }

    const loadedOrganizationName = settings.organization_name ?? "";
    const loadedMissionStatement = settings.mission_statement ?? "";
    const loadedVisionStatement = settings.vision_statement ?? "";
    const loadedValuesStatement = settings.values_statement ?? "";
    const loadedManagerPortalAccessMode =
      settings.manager_portal_access_mode ?? "disabled";

    setCurrentOrganizationName(loadedOrganizationName);
    setCurrentMissionStatement(loadedMissionStatement);
    setCurrentVisionStatement(loadedVisionStatement);
    setCurrentValuesStatement(loadedValuesStatement);

    setSettingsOrganizationName(loadedOrganizationName);
    setSettingsMissionStatement(loadedMissionStatement);
    setSettingsVisionStatement(loadedVisionStatement);
    setSettingsValuesStatement(loadedValuesStatement);
    setSettingsManagerPortalAccessMode(loadedManagerPortalAccessMode);

    setIsLoadingSettings(false);
  }

  async function loadOrganizationPortalCreditSummary() {
    if (!organizationId) {
      setOrganizationPortalCreditSummary(null);
      setOrganizationPortalCreditMessage(
        "Unable to load portal AI credit information.",
      );
      return;
    }

    setIsLoadingOrganizationPortalCredits(true);
    setOrganizationPortalCreditMessage("");

    const { data, error } = await supabase.rpc(
      "get_organization_portal_credit_summary",
      {
        p_organization_id: organizationId,
      },
    );

    if (error) {
      console.error(
        "Organization portal credit summary failed to load:",
        error,
      );

      setOrganizationPortalCreditSummary(null);
      setOrganizationPortalCreditMessage(
        error.message || "Unable to load portal AI credit information.",
      );
      setIsLoadingOrganizationPortalCredits(false);
      return;
    }

    const creditSummaryRow = data?.[0];

    if (!creditSummaryRow) {
      setOrganizationPortalCreditSummary(null);
      setOrganizationPortalCreditMessage(
        "No portal AI credit information was found.",
      );
      setIsLoadingOrganizationPortalCredits(false);
      return;
    }

    setOrganizationPortalCreditSummary({
      portal_credits_available: Number(
        creditSummaryRow.portal_credits_available ?? 0,
      ),
      portal_credits_used: Number(creditSummaryRow.portal_credits_used ?? 0),
      portal_credit_period_start:
        creditSummaryRow.portal_credit_period_start ?? null,
      portal_credit_renewal_date:
        creditSummaryRow.portal_credit_renewal_date ?? null,
    });

    setIsLoadingOrganizationPortalCredits(false);
  }

  async function handleGenerateOrganizationMvv() {
    const normalizedOrganizationName = settingsOrganizationName.trim();
    const normalizedOrganizationPurpose = mvvOrganizationPurpose.trim();
    const normalizedCustomersServed = mvvCustomersServed.trim();
    const normalizedProductsOrServices = mvvProductsOrServices.trim();
    const normalizedFutureDirection = mvvFutureDirection.trim();
    const normalizedOperatingPrinciples = mvvOperatingPrinciples.trim();

    if (!normalizedOrganizationName) {
      setMvvGenerationMessage(
        "Enter the organization name before generating statements.",
      );
      return;
    }

    if (!normalizedOrganizationPurpose) {
      setMvvGenerationMessage("Describe why the organization exists.");
      return;
    }

    if (!normalizedCustomersServed) {
      setMvvGenerationMessage("Describe who the organization serves.");
      return;
    }

    if (!normalizedProductsOrServices) {
      setMvvGenerationMessage("Describe what the organization provides.");
      return;
    }

    if (!normalizedFutureDirection) {
      setMvvGenerationMessage(
        "Describe the future the organization is working toward.",
      );
      return;
    }

    if (!normalizedOperatingPrinciples) {
      setMvvGenerationMessage(
        "Describe the principles that guide the organization.",
      );
      return;
    }

    if (
      !organizationPortalCreditSummary ||
      organizationPortalCreditSummary.portal_credits_available < 1
    ) {
      setMvvGenerationMessage("No portal AI credits are currently available.");
      return;
    }

    setIsGeneratingMvv(true);
    setMvvGenerationMessage(
      "Generating Mission, Vision, and Values suggestions...",
    );

    const { data, error } =
      await supabase.functions.invoke<GenerateOrganizationMvvResponse>(
        "generate-organization-mvv",
        {
          body: {
            organizationId,
            organizationName: normalizedOrganizationName,
            organizationPurpose: normalizedOrganizationPurpose,
            customersServed: normalizedCustomersServed,
            productsOrServices: normalizedProductsOrServices,
            futureDirection: normalizedFutureDirection,
            operatingPrinciples: normalizedOperatingPrinciples,
          },
        },
      );

    if (error || data?.error) {
      let errorMessage =
        data?.error ||
        error?.message ||
        "The Mission, Vision, and Values suggestions could not be generated.";

      if (error && "context" in error && error.context instanceof Response) {
        try {
          const errorBody =
            (await error.context.json()) as GenerateOrganizationMvvResponse;

          if (errorBody.error) {
            errorMessage = errorBody.error;
          }
        } catch {
          console.error("The MVV generation error response could not be read.");
        }
      }

      console.error("Organization MVV generation failed:", error, errorMessage);

      setMvvGenerationMessage(errorMessage);
      setIsGeneratingMvv(false);
      return;
    }

    const generatedMission = data?.missionStatement?.trim() ?? "";
    const generatedVision = data?.visionStatement?.trim() ?? "";
    const generatedValues = data?.valuesStatement?.trim() ?? "";

    if (!generatedMission || !generatedVision || !generatedValues) {
      setMvvGenerationMessage(
        "The AI response did not contain complete Mission, Vision, and Values suggestions.",
      );
      setIsGeneratingMvv(false);
      return;
    }

    setSettingsMissionStatement(generatedMission);
    setSettingsVisionStatement(generatedVision);
    setSettingsValuesStatement(generatedValues);

    if (
      typeof data?.portalCreditsAvailable === "number" &&
      typeof data?.portalCreditsUsed === "number"
    ) {
      setOrganizationPortalCreditSummary((currentSummary) => ({
        portal_credits_available: data.portalCreditsAvailable ?? 0,
        portal_credits_used: data.portalCreditsUsed ?? 0,
        portal_credit_period_start:
          currentSummary?.portal_credit_period_start ?? null,
        portal_credit_renewal_date:
          data.portalCreditRenewalDate ??
          currentSummary?.portal_credit_renewal_date ??
          null,
      }));
    } else {
      void loadOrganizationPortalCreditSummary();
    }

    setMvvGenerationMessage(
      "Suggestions generated. Review and edit them, then save the organization settings.",
    );
    setSettingsMessage("");
    setIsGeneratingMvv(false);
  }

  async function handleSaveOrganizationSettings() {
    const normalizedOrganizationName = settingsOrganizationName.trim();

    if (!normalizedOrganizationName) {
      setSettingsMessage("Enter the organization name.");
      return;
    }

    setIsSavingSettings(true);
    setSettingsMessage("Saving organization settings...");

    const { data, error } = await supabase.rpc("update_organization_settings", {
      p_organization_id: organizationId,
      p_organization_name: normalizedOrganizationName,
      p_mission_statement: settingsMissionStatement.trim(),
      p_vision_statement: settingsVisionStatement.trim(),
      p_values_statement: settingsValuesStatement.trim(),
      p_manager_portal_access_mode: settingsManagerPortalAccessMode,
    });

    if (error) {
      console.error("Organization settings failed to save:", error);
      setSettingsMessage(
        error.message || "The organization settings could not be saved.",
      );
      setIsSavingSettings(false);
      return;
    }

    const savedSettings = data?.[0];

    if (!savedSettings) {
      setSettingsMessage(
        "The organization settings were saved, but the updated values could not be loaded.",
      );
      setIsSavingSettings(false);
      return;
    }

    const savedOrganizationName = savedSettings.organization_name ?? "";
    const savedMissionStatement = savedSettings.mission_statement ?? "";
    const savedVisionStatement = savedSettings.vision_statement ?? "";
    const savedValuesStatement = savedSettings.values_statement ?? "";
    const savedManagerPortalAccessMode =
      savedSettings.manager_portal_access_mode ?? "disabled";

    setCurrentOrganizationName(savedOrganizationName);
    setCurrentMissionStatement(savedMissionStatement);
    setCurrentVisionStatement(savedVisionStatement);
    setCurrentValuesStatement(savedValuesStatement);

    setSettingsOrganizationName(savedOrganizationName);
    setSettingsMissionStatement(savedMissionStatement);
    setSettingsVisionStatement(savedVisionStatement);
    setSettingsValuesStatement(savedValuesStatement);
    setSettingsManagerPortalAccessMode(savedManagerPortalAccessMode);

    setSettingsMessage("Organization settings saved.");
    setIsSavingSettings(false);
  }

  async function loadOrganizationAiCreditSummary() {
    if (!organizationId) {
      setOrganizationAiCreditSummary(null);
      setOrganizationAiCreditMessage(
        "Unable to load organization AI credit information.",
      );
      return;
    }

    setIsLoadingOrganizationAiCredits(true);
    setOrganizationAiCreditMessage("");

    const { data, error } = await supabase.rpc(
      "get_organization_ai_credit_summary",
      {
        p_organization_id: organizationId,
      },
    );

    if (error) {
      console.error("Organization AI credit summary failed to load:", error);
      setOrganizationAiCreditSummary(null);
      setOrganizationAiCreditMessage(
        error.message || "Unable to load organization AI credit information.",
      );
      setIsLoadingOrganizationAiCredits(false);
      return;
    }

    const creditSummaryRow = data?.[0];

    if (!creditSummaryRow) {
      setOrganizationAiCreditSummary(null);
      setOrganizationAiCreditMessage(
        "No organization AI credit information was found.",
      );
      setIsLoadingOrganizationAiCredits(false);
      return;
    }

    setOrganizationAiCreditSummary({
      ai_credits_available: Number(creditSummaryRow.ai_credits_available ?? 0),
      ai_credits_used: Number(creditSummaryRow.ai_credits_used ?? 0),
      ai_credit_period_start: creditSummaryRow.ai_credit_period_start ?? null,
      ai_credit_renewal_date: creditSummaryRow.ai_credit_renewal_date ?? null,
    });

    setIsLoadingOrganizationAiCredits(false);
  }

  async function loadOrganizationReports() {
    if (!organizationId) {
      setReportMessage("Unable to load organization reports.");
      return;
    }

    setIsLoadingReports(true);
    setReportMessage("");
    setComparisonReportRows([]);
    setTrackableEntriesByTrackableId({});
    setDecisionAnalysesByDecisionId({});

    const selectedUserIds =
      selectedReportUserIds.size > 0 ? Array.from(selectedReportUserIds) : null;

    const selectedGroupIds =
      selectedReportGroupIds.size > 0
        ? Array.from(selectedReportGroupIds)
        : null;

    const [
      usageReportResult,
      activePriorityReportResult,
      retiredPriorityReportResult,
    ] = await Promise.all([
      supabase.rpc("get_organization_usage_report", {
        p_organization_id: organizationId,
        p_user_ids: selectedUserIds,
        p_group_ids: selectedGroupIds,
      }),
      supabase.rpc("get_organization_priority_detail_report", {
        p_organization_id: organizationId,
        p_priority_status: "active",
        p_user_ids: selectedUserIds,
        p_group_ids: selectedGroupIds,
      }),
      supabase.rpc("get_organization_priority_detail_report", {
        p_organization_id: organizationId,
        p_priority_status: "retired",
        p_user_ids: selectedUserIds,
        p_group_ids: selectedGroupIds,
      }),
    ]);

    const reportError =
      usageReportResult.error ??
      activePriorityReportResult.error ??
      retiredPriorityReportResult.error;

    if (reportError) {
      console.error("Organization report failed to load:", reportError);
      setUsageReport(null);
      setActivePriorityReport([]);
      setRetiredPriorityReport([]);
      setComparisonReportRows([]);
      setReportMessage(
        reportError.message || "The organization report could not be loaded.",
      );
      setIsLoadingReports(false);
      return;
    }

    const usageRow = usageReportResult.data?.[0];

    if (!usageRow) {
      setUsageReport(null);
      setActivePriorityReport([]);
      setRetiredPriorityReport([]);
      setComparisonReportRows([]);
      setReportMessage(
        "The organization report returned no usage information.",
      );
      setIsLoadingReports(false);
      return;
    }

    const nextUsageReport: OrganizationUsageReport = {
      selected_user_count: Number(usageRow.selected_user_count ?? 0),
      priority_count: Number(usageRow.priority_count ?? 0),
      decision_count: Number(usageRow.decision_count ?? 0),
      trackable_count: Number(usageRow.trackable_count ?? 0),
      ai_credits_used: Number(usageRow.ai_credits_used ?? 0),
    };

    let nextComparisonRows: OrganizationComparisonReportRow[] = [];

    if (selectedUserIds && selectedUserIds.length > 1) {
      const individualResults = await Promise.all(
        selectedUserIds.map(async (userId) => {
          const result = await supabase.rpc("get_organization_usage_report", {
            p_organization_id: organizationId,
            p_user_ids: [userId],
            p_group_ids: null,
          });

          return {
            userId,
            result,
          };
        }),
      );

      const comparisonError = individualResults.find(
        ({ result }) => result.error,
      )?.result.error;

      if (comparisonError) {
        console.error("Individual comparison failed to load:", comparisonError);
        setUsageReport(null);
        setActivePriorityReport([]);
        setRetiredPriorityReport([]);
        setComparisonReportRows([]);
        setReportMessage(
          comparisonError.message ||
            "The individual comparison could not be loaded.",
        );
        setIsLoadingReports(false);
        return;
      }

      nextComparisonRows = individualResults.map(({ userId, result }) => {
        const row = result.data?.[0];

        const user = organizationUsers.find(
          (organizationUser) => organizationUser.user_id === userId,
        );

        return {
          id: userId,
          name: user?.full_name ?? user?.email_address ?? "Unknown user",
          selected_user_count: Number(row?.selected_user_count ?? 0),
          priority_count: Number(row?.priority_count ?? 0),
          decision_count: Number(row?.decision_count ?? 0),
          trackable_count: Number(row?.trackable_count ?? 0),
          ai_credits_used: Number(row?.ai_credits_used ?? 0),
        };
      });
    } else if (selectedGroupIds && selectedGroupIds.length > 1) {
      const groupResults = await Promise.all(
        selectedGroupIds.map(async (groupId) => {
          const result = await supabase.rpc("get_organization_usage_report", {
            p_organization_id: organizationId,
            p_user_ids: null,
            p_group_ids: [groupId],
          });

          return {
            groupId,
            result,
          };
        }),
      );

      const comparisonError = groupResults.find(({ result }) => result.error)
        ?.result.error;

      if (comparisonError) {
        console.error("Group comparison failed to load:", comparisonError);
        setUsageReport(null);
        setActivePriorityReport([]);
        setRetiredPriorityReport([]);
        setComparisonReportRows([]);
        setReportMessage(
          comparisonError.message ||
            "The group comparison could not be loaded.",
        );
        setIsLoadingReports(false);
        return;
      }

      nextComparisonRows = groupResults.map(({ groupId, result }) => {
        const row = result.data?.[0];

        const group = organizationGroups.find(
          (organizationGroup) => organizationGroup.id === groupId,
        );

        return {
          id: groupId,
          name: group?.name ?? "Unknown group",
          selected_user_count: Number(row?.selected_user_count ?? 0),
          priority_count: Number(row?.priority_count ?? 0),
          decision_count: Number(row?.decision_count ?? 0),
          trackable_count: Number(row?.trackable_count ?? 0),
          ai_credits_used: Number(row?.ai_credits_used ?? 0),
        };
      });
    }

    nextComparisonRows.sort((firstRow, secondRow) =>
      firstRow.name.localeCompare(secondRow.name),
    );

    const nextActivePriorityReport = (activePriorityReportResult.data ??
      []) as OrganizationPriorityDetailReport[];

    const nextRetiredPriorityReport = (retiredPriorityReportResult.data ??
      []) as OrganizationPriorityDetailReport[];

    const allPriorityReports = [
      ...nextActivePriorityReport,
      ...nextRetiredPriorityReport,
    ];

    const trackableIds = allPriorityReports.flatMap((priority) =>
      priority.trackables.map((trackable) => trackable.id),
    );

    const decisionIds = allPriorityReports.flatMap((priority) =>
      priority.decisions.map((decision) => decision.id),
    );

    let nextTrackableEntriesByTrackableId: Record<
      string,
      TrackableEntryExportItem[]
    > = {};

    let nextDecisionAnalysesByDecisionId: Record<
      string,
      DecisionAnalysisExportItem[]
    > = {};

    const [trackableEntriesResult, decisionAnalysesResult] = await Promise.all([
      trackableIds.length > 0
        ? supabase.rpc("get_trackable_entries_for_export", {
            p_organization_id: organizationId,
            p_trackable_ids: trackableIds,
          })
        : Promise.resolve({
            data: [],
            error: null,
          }),
      decisionIds.length > 0
        ? supabase.rpc("get_decision_analysis_for_export", {
            p_organization_id: organizationId,
            p_decision_ids: decisionIds,
          })
        : Promise.resolve({
            data: [],
            error: null,
          }),
    ]);

    const exportDataError =
      trackableEntriesResult.error ?? decisionAnalysesResult.error;

    if (exportDataError) {
      console.error("Report export data failed to load:", exportDataError);

      setUsageReport(null);
      setActivePriorityReport([]);
      setRetiredPriorityReport([]);
      setComparisonReportRows([]);
      setTrackableEntriesByTrackableId({});
      setDecisionAnalysesByDecisionId({});
      setReportMessage(
        exportDataError.message ||
          "The report export details could not be loaded.",
      );
      setIsLoadingReports(false);
      return;
    }

    const trackableEntries = (trackableEntriesResult.data ??
      []) as TrackableEntryExportItem[];

    nextTrackableEntriesByTrackableId = trackableEntries.reduce<
      Record<string, TrackableEntryExportItem[]>
    >((entriesByTrackableId, entry) => {
      if (!entriesByTrackableId[entry.trackable_id]) {
        entriesByTrackableId[entry.trackable_id] = [];
      }

      entriesByTrackableId[entry.trackable_id].push(entry);

      return entriesByTrackableId;
    }, {});

    const decisionAnalyses = (decisionAnalysesResult.data ??
      []) as DecisionAnalysisExportItem[];

    nextDecisionAnalysesByDecisionId = decisionAnalyses.reduce<
      Record<string, DecisionAnalysisExportItem[]>
    >((analysesByDecisionId, analysis) => {
      if (!analysesByDecisionId[analysis.decision_id]) {
        analysesByDecisionId[analysis.decision_id] = [];
      }

      analysesByDecisionId[analysis.decision_id].push(analysis);

      return analysesByDecisionId;
    }, {});

    setUsageReport(nextUsageReport);
    setActivePriorityReport(nextActivePriorityReport);
    setRetiredPriorityReport(nextRetiredPriorityReport);
    setComparisonReportRows(nextComparisonRows);
    setTrackableEntriesByTrackableId(nextTrackableEntriesByTrackableId);
    setDecisionAnalysesByDecisionId(nextDecisionAnalysesByDecisionId);
    setHasLoadedReports(true);
    setIsLoadingReports(false);
  }

  function exportComparisonReportCsv() {
    if (!usageReport || comparisonReportRows.length === 0) {
      return;
    }

    const comparisonType =
      selectedReportUserIds.size > 1 ? "Individual" : "Group";

    downloadCsvFile(
      `everward-${comparisonType.toLowerCase()}-comparison.csv`,
      [
        comparisonType,
        "People included",
        "Priorities set",
        "Decisions made",
        "Trackables",
        "AI credits used",
      ],
      [
        ...comparisonReportRows.map((row) => [
          row.name,
          row.selected_user_count,
          row.priority_count,
          row.decision_count,
          row.trackable_count,
          row.ai_credits_used,
        ]),
        [
          "Total",
          usageReport.selected_user_count,
          usageReport.priority_count,
          usageReport.decision_count,
          usageReport.trackable_count,
          usageReport.ai_credits_used,
        ],
      ],
    );
  }

  function exportPriorityReportCsv(status: "active" | "retired") {
    const priorities =
      status === "active" ? activePriorityReport : retiredPriorityReport;

    if (priorities.length === 0) {
      return;
    }

    const exportRows: unknown[][] = [];

    function rowMatchesSearch(
      fields: Array<string | number | null | undefined>,
    ) {
      if (!normalizedReportDetailSearchQuery) {
        return true;
      }

      return fields.some((field) =>
        String(field ?? "")
          .toLowerCase()
          .includes(normalizedReportDetailSearchQuery),
      );
    }

    priorities.forEach((priority) => {
      const priorityMatches = rowMatchesSearch([
        priority.user_full_name,
        priority.user_email,
        priority.group_name,
        priority.priority_title,
        priority.priority_description,
        priority.priority_status,
      ]);

      if (priorityMatches) {
        exportRows.push([
          "Priority",
          priority.user_full_name,
          priority.user_email,
          priority.group_name ?? "",
          priority.priority_title,
          priority.priority_description ?? "",
          priority.priority_status,
          formatReportDate(priority.priority_created_at),
          formatReportDate(priority.priority_completed_at),
          formatReportDate(priority.priority_retired_at),
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]);
      }

      priority.decisions.forEach((decision) => {
        const decisionMatches = rowMatchesSearch([
          decision.title,
          decision.description,
          decision.status,
        ]);

        if (decisionMatches) {
          exportRows.push([
            "Decision",
            priority.user_full_name,
            priority.user_email,
            priority.group_name ?? "",
            priority.priority_title,
            priority.priority_description ?? "",
            decision.status,
            formatReportDate(decision.created_at),
            "",
            "",
            decision.title,
            decision.description ?? "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ]);
        }

        const decisionAnalyses =
          decisionAnalysesByDecisionId[decision.id] ?? [];

        decisionAnalyses.forEach((analysis) => {
          const analysisMatches = rowMatchesSearch([
            analysis.analysis_type,
            analysis.analysis_label,
            analysis.analysis_summary,
            analysis.alignment_signal,
            analysis.priority_alignment,
            analysis.risk_tradeoff,
            analysis.better_next_decision,
            analysis.suggested_trackable,
            analysis.next_step,
            analysis.analysis_note,
            analysis.insight_level,
            analysis.decision_pattern_read,
            analysis.priority_pressure,
            analysis.execution_risk,
            analysis.highest_leverage_followup,
            analysis.evidence_quality,
          ]);

          if (!analysisMatches) {
            return;
          }

          exportRows.push([
            "Decision AI analysis",
            priority.user_full_name,
            priority.user_email,
            priority.group_name ?? "",
            priority.priority_title,
            priority.priority_description ?? "",
            "",
            formatReportDate(analysis.analysis_created_at),
            "",
            "",
            decision.title,
            decision.description ?? "",
            "",
            "",
            "",
            "",
            "",
            "",
            analysis.analysis_type,
            analysis.analysis_label,
            analysis.analysis_summary,
            analysis.alignment_signal,
            analysis.priority_alignment,
            analysis.risk_tradeoff,
            analysis.better_next_decision,
            analysis.suggested_trackable,
            analysis.next_step,
            analysis.analysis_note,
            analysis.insight_level,
            analysis.decision_pattern_read,
            analysis.priority_pressure,
            analysis.execution_risk,
            analysis.highest_leverage_followup,
            analysis.evidence_quality,
            analysis.credits_used,
          ]);
        });
      });

      priority.trackables.forEach((trackable) => {
        const trackableMatches = rowMatchesSearch([
          trackable.title,
          trackable.description,
          trackable.unit,
          trackable.status,
          trackable.better_when,
        ]);

        if (trackableMatches) {
          exportRows.push([
            "Trackable",
            priority.user_full_name,
            priority.user_email,
            priority.group_name ?? "",
            priority.priority_title,
            priority.priority_description ?? "",
            trackable.status,
            formatReportDate(trackable.created_at),
            formatReportDate(trackable.completed_at),
            formatReportDate(trackable.retired_at),
            "",
            "",
            trackable.title,
            trackable.unit ?? "",
            trackable.better_when ?? "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ]);
        }

        const trackableEntries =
          trackableEntriesByTrackableId[trackable.id] ?? [];

        trackableEntries.forEach((entry) => {
          const entryMatches = rowMatchesSearch([
            entry.entry_value,
            entry.entry_note,
            entry.entry_status,
          ]);

          if (!entryMatches) {
            return;
          }

          exportRows.push([
            "Trackable entry",
            priority.user_full_name,
            priority.user_email,
            priority.group_name ?? "",
            priority.priority_title,
            priority.priority_description ?? "",
            entry.entry_status,
            "",
            "",
            "",
            "",
            "",
            trackable.title,
            trackable.unit ?? "",
            trackable.better_when ?? "",
            formatReportDate(entry.entry_recorded_at),
            entry.entry_value,
            entry.entry_note,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ]);
        });
      });
    });

    if (exportRows.length === 0) {
      return;
    }

    downloadCsvFile(
      `everward-${status}-priority-details.csv`,
      [
        "Record type",
        "Employee",
        "Employee email",
        "Group",
        "Priority",
        "Priority description",
        "Status",
        "Created date",
        "Completed date",
        "Retired date",
        "Decision title",
        "Decision description",
        "Trackable title",
        "Trackable unit",
        "Trackable direction",
        "Trackable entry date",
        "Trackable entry value",
        "Trackable entry note",
        "AI analysis type",
        "AI result label",
        "AI summary",
        "Alignment signal",
        "Priority alignment",
        "Risk or tradeoff",
        "Better next decision",
        "Suggested Trackable",
        "Next step",
        "AI note",
        "Insight level",
        "Decision pattern read",
        "Priority pressure",
        "Execution risk",
        "Highest-leverage follow-up",
        "Evidence quality",
        "AI credits used",
      ],
      exportRows,
    );
  }

  async function handleSaveUser() {
    if (!selectedUser) {
      return;
    }

    const normalizedFullName = editFullName.trim();
    const normalizedEmail = editEmail.trim().toLowerCase();

    if (!normalizedFullName) {
      setEditUserMessage("Enter the user’s full name.");
      return;
    }

    if (!normalizedEmail) {
      setEditUserMessage("Enter the user’s email address.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setEditUserMessage("Enter a valid email address.");
      return;
    }

    if (editPassword && editPassword.length < 8) {
      setEditUserMessage(
        "The replacement password must contain at least 8 characters.",
      );
      return;
    }

    if (editIsActive && editIsBillable && !editPrimaryGroupId) {
      setEditUserMessage("Select the user’s primary group.");
      return;
    }

    if (
      editIsBillable &&
      !selectedUser.is_billable &&
      editIsActive &&
      seatSummary.availableSeatCount === 0
    ) {
      setEditUserMessage(
        "No purchased seat is available. Add another seat in Billing before enabling app access.",
      );
      return;
    }

    setIsSavingUser(true);
    setEditUserMessage("Saving user changes...");

    const { data: profileUpdateData, error: profileUpdateError } =
      await supabase.functions.invoke<{
        error?: string;
        message?: string;
      }>("update-organization-user", {
        body: {
          organizationId,
          organizationUserId: selectedUser.organization_user_id,
          fullName: normalizedFullName,
          email: normalizedEmail,
          password: editPassword,
        },
      });

    if (profileUpdateError || profileUpdateData?.error) {
      let functionErrorMessage =
        profileUpdateData?.error ??
        profileUpdateError?.message ??
        "The user name, email, or password could not be updated.";

      if (
        profileUpdateError &&
        "context" in profileUpdateError &&
        profileUpdateError.context instanceof Response
      ) {
        try {
          const errorBody = (await profileUpdateError.context.json()) as {
            error?: string;
          };

          if (errorBody.error) {
            functionErrorMessage = errorBody.error;
          }
        } catch {
          console.error("The Edge Function error response could not be read.");
        }
      }

      console.error(
        "Organization user profile update failed:",
        profileUpdateError,
        functionErrorMessage,
      );

      setEditUserMessage(functionErrorMessage);
      setIsSavingUser(false);
      return;
    }

    const { error: organizationUpdateError } = await supabase.rpc(
      "update_organization_user",
      {
        p_organization_id: organizationId,
        p_organization_user_id: selectedUser.organization_user_id,
        p_role: editRole,
        p_primary_group_id:
          editIsActive && editIsBillable ? editPrimaryGroupId || null : null,
        p_is_active: editIsActive,
        p_is_billable: editIsBillable,
        p_billing_access_enabled: selectedUser.is_organization_owner
          ? true
          : editBillingAccessEnabled,
        p_manager_portal_access_enabled:
          editRole === "group_manager" && editIsActive && editIsBillable
            ? editManagerPortalAccessEnabled
            : false,
      },
    );

    if (organizationUpdateError) {
      console.error(
        "Organization user update failed:",
        organizationUpdateError,
      );
      setEditUserMessage(
        organizationUpdateError.message ||
          "The user access changes could not be saved.",
      );
      setIsSavingUser(false);
      return;
    }

    await loadDashboardData();
    setSelectedUser(null);
    setEditPassword("");
    setEditUserMessage("");
    setIsSavingUser(false);
  }

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <img src="/icon.png" alt="Everward" />

          <div>
            <span>Everward</span>
            <small>Organization Portal</small>
          </div>
        </div>

        <div className="dashboard-account">
          <div>
            <strong>{accountEmail}</strong>
            <span>{formatRole(role)}</span>
          </div>

          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              void onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="organization-dashboard-layout">
        <aside className="organization-dashboard-sidebar">
          <div className="organization-dashboard-sidebar-heading">
            <span>{currentOrganizationName}</span>
            <small>Management portal</small>
          </div>

          <nav
            className="organization-dashboard-navigation"
            aria-label="Organization portal"
          >
            {role !== "member" || !billingAccessEnabled ? (
              <button
                className={
                  activeView === "overview"
                    ? "organization-dashboard-nav-button organization-dashboard-nav-button-active"
                    : "organization-dashboard-nav-button"
                }
                type="button"
                onClick={() => {
                  openView("overview");
                }}
              >
                Overview
              </button>
            ) : null}

            {canManageUsers ? (
              <button
                className={
                  activeView === "users"
                    ? "organization-dashboard-nav-button organization-dashboard-nav-button-active"
                    : "organization-dashboard-nav-button"
                }
                type="button"
                onClick={() => {
                  openView("users");
                }}
              >
                Users
              </button>
            ) : null}

            {canManageGroups ? (
              <button
                className={
                  activeView === "groups"
                    ? "organization-dashboard-nav-button organization-dashboard-nav-button-active"
                    : "organization-dashboard-nav-button"
                }
                type="button"
                onClick={() => {
                  openView("groups");
                }}
              >
                Groups
              </button>
            ) : null}

            {canViewBilling ? (
              <button
                className={
                  activeView === "billing"
                    ? "organization-dashboard-nav-button organization-dashboard-nav-button-active"
                    : "organization-dashboard-nav-button"
                }
                type="button"
                onClick={() => {
                  openView("billing");
                }}
              >
                Billing and Seats
              </button>
            ) : null}

            {canViewReports ? (
              <button
                className={
                  activeView === "reports"
                    ? "organization-dashboard-nav-button organization-dashboard-nav-button-active"
                    : "organization-dashboard-nav-button"
                }
                type="button"
                onClick={() => {
                  openView("reports");
                }}
              >
                Reports
              </button>
            ) : null}

            {canViewReports ? (
              <button
                className={
                  activeView === "analyze"
                    ? "organization-dashboard-nav-button organization-dashboard-nav-button-active"
                    : "organization-dashboard-nav-button"
                }
                type="button"
                onClick={() => {
                  openView("analyze");
                }}
              >
                Analyze Company Data
              </button>
            ) : null}

            {canViewCompanyKnowledge ? (
              <button
                className={
                  activeView === "knowledge"
                    ? "organization-dashboard-nav-button organization-dashboard-nav-button-active"
                    : "organization-dashboard-nav-button"
                }
                type="button"
                onClick={() => {
                  openView("knowledge");
                }}
              >
                Company Knowledge
              </button>
            ) : null}

            {canManageOrganizationSettings ? (
              <button
                className={
                  activeView === "settings"
                    ? "organization-dashboard-nav-button organization-dashboard-nav-button-active"
                    : "organization-dashboard-nav-button"
                }
                type="button"
                onClick={() => {
                  openView("settings");
                }}
              >
                Organization Settings
              </button>
            ) : null}
          </nav>
        </aside>

        <section className="dashboard-content organization-dashboard-content">
          {activeView === "overview" ? (
            <>
              <div className="dashboard-welcome">
                <p className="eyebrow">Organization dashboard</p>
                <h1>Welcome to {currentOrganizationName}</h1>
                <p>
                  Manage your organization, users, groups, billing, and
                  reporting from the Everward organization portal.
                </p>
              </div>

              <div className="dashboard-grid">
                <article className="dashboard-card">
                  <span className="dashboard-card-label">Your role</span>
                  <strong>{formatRole(role)}</strong>
                  <p>
                    Your available portal controls are based on this
                    organization role.
                  </p>
                </article>

                <article className="dashboard-card">
                  <span className="dashboard-card-label">Subscription</span>
                  <strong>
                    {subscriptionStatus === "active"
                      ? "Active"
                      : formatRole(subscriptionStatus)}
                  </strong>
                  <p>
                    View purchased seats, current usage, and billing information
                    from Billing and Seats.
                  </p>
                </article>

                <article className="dashboard-card">
                  <span className="dashboard-card-label">
                    Organization setup
                  </span>
                  <strong>Complete</strong>
                  <p>
                    Your organization structure and initial user setup are
                    complete.
                  </p>
                </article>
              </div>

              {canViewBilling ? (
                <section className="dashboard-seat-overview">
                  <div className="dashboard-section-heading">
                    <div>
                      <p className="eyebrow">User capacity</p>
                      <h2>Organization seats</h2>
                    </div>

                    {canManageUsers ? (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => {
                          openView("users");
                        }}
                      >
                        Manage users
                      </button>
                    ) : null}
                  </div>

                  {isLoadingSeats ? (
                    <p className="form-message">Loading seat information...</p>
                  ) : seatMessage ? (
                    <p className="form-message" role="alert">
                      {seatMessage}
                    </p>
                  ) : (
                    <div className="seat-summary">
                      <div>
                        <span>Purchased seats</span>
                        <strong>{seatSummary.purchasedSeatCount}</strong>
                      </div>

                      <div>
                        <span>Seats in use</span>
                        <strong>{seatSummary.usedSeatCount}</strong>
                      </div>

                      <div>
                        <span>Available seats</span>
                        <strong>{seatSummary.availableSeatCount}</strong>
                      </div>
                    </div>
                  )}
                </section>
              ) : null}

              {hasOrganizationFoundation ? (
                <section className="organization-foundation">
                  <div className="foundation-heading">
                    <p className="eyebrow">Organization foundation</p>
                    <h2>Shared direction for {currentOrganizationName}</h2>
                  </div>

                  <div className="foundation-grid">
                    <article className="foundation-card">
                      <span>Mission</span>
                      <p>
                        {currentMissionStatement.trim() ||
                          "No mission statement added."}
                      </p>
                    </article>

                    <article className="foundation-card">
                      <span>Vision</span>
                      <p>
                        {currentVisionStatement.trim() ||
                          "No vision statement added."}
                      </p>
                    </article>

                    <article className="foundation-card">
                      <span>Values</span>
                      <p>
                        {currentValuesStatement.trim() ||
                          "No values statement added."}
                      </p>
                    </article>
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          {activeView === "users" && isAddingUsers ? (
            <OrganizationUserSetup
              organizationId={organizationId}
              mode="management"
              onUsersChanged={() => {
                void loadDashboardData();
              }}
              onBack={() => {
                setIsAddingUsers(false);
                void loadDashboardData();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          ) : null}

          {activeView === "users" && !isAddingUsers && selectedUser ? (
            <section className="dashboard-management-section">
              <div className="dashboard-section-heading">
                <div>
                  <p className="eyebrow">User management</p>
                  <h1>Edit {selectedUser.full_name}</h1>
                  <p>{selectedUser.email_address}</p>
                </div>

                <button
                  className="text-button"
                  type="button"
                  disabled={isSavingUser}
                  onClick={closeUserEditor}
                >
                  Back to user directory
                </button>
              </div>

              <div className="user-edit-form">
                <div className="setup-field">
                  <label htmlFor="edit-user-full-name">Full name</label>

                  <input
                    id="edit-user-full-name"
                    type="text"
                    value={editFullName}
                    disabled={isSavingUser}
                    onChange={(event) => {
                      setEditFullName(event.target.value);
                      setEditUserMessage("");
                    }}
                  />
                </div>

                <div className="setup-field">
                  <label htmlFor="edit-user-email">Email address</label>

                  <input
                    id="edit-user-email"
                    type="email"
                    value={editEmail}
                    disabled={isSavingUser}
                    onChange={(event) => {
                      setEditEmail(event.target.value);
                      setEditUserMessage("");
                    }}
                  />
                </div>

                <div className="setup-field">
                  <label htmlFor="edit-user-password">
                    Replacement password
                  </label>

                  <input
                    id="edit-user-password"
                    type="password"
                    value={editPassword}
                    disabled={isSavingUser}
                    autoComplete="new-password"
                    onChange={(event) => {
                      setEditPassword(event.target.value);
                      setEditUserMessage("");
                    }}
                  />

                  <p className="setup-help">
                    Leave blank to keep the current password. A new password
                    must contain at least 8 characters.
                  </p>
                </div>

                <div className="setup-field">
                  <label htmlFor="edit-user-role">Organization role</label>

                  <select
                    id="edit-user-role"
                    value={editRole}
                    disabled={
                      isSavingUser || selectedUser.is_organization_owner
                    }
                    onChange={(event) => {
                      setEditRole(event.target.value as OrganizationRole);
                      setEditUserMessage("");

                      if (event.target.value !== "group_manager") {
                        setEditManagerPortalAccessEnabled(false);
                      }

                      if (
                        event.target.value === "group_manager" &&
                        !editIsBillable
                      ) {
                        setEditIsBillable(true);
                      }
                    }}
                  >
                    {roleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  {selectedUser.is_organization_owner ? (
                    <p className="setup-help">
                      The organization owner must remain an Organization Admin.
                    </p>
                  ) : null}
                </div>

                {editRole !== "billing_admin" ? (
                  <div className="setup-field">
                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "10px",
                      }}
                    >
                      <input
                        type="checkbox"
                        style={{
                          width: "auto",
                          flex: "0 0 auto",
                          marginTop: "3px",
                        }}
                        checked={
                          selectedUser.is_organization_owner
                            ? true
                            : editBillingAccessEnabled
                        }
                        disabled={
                          isSavingUser || selectedUser.is_organization_owner
                        }
                        onChange={(event) => {
                          setEditBillingAccessEnabled(event.target.checked);
                          setEditUserMessage("");
                        }}
                      />
                      Give this user billing access
                    </label>

                    <p className="setup-help">
                      This adds Billing and Seats access in addition to the
                      organization role selected above.
                    </p>
                  </div>
                ) : null}

                <div className="setup-field">
                  <label htmlFor="edit-user-primary-group">Primary group</label>

                  <select
                    id="edit-user-primary-group"
                    value={editPrimaryGroupId}
                    disabled={isSavingUser || !editIsActive || !editIsBillable}
                    onChange={(event) => {
                      setEditPrimaryGroupId(event.target.value);
                      setEditUserMessage("");
                    }}
                  >
                    <option value="">Select a group</option>

                    {organizationGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>

                  {groupMessage ? (
                    <p className="field-error">{groupMessage}</p>
                  ) : null}
                </div>

                <div className="user-access-options">
                  <label className="user-access-option">
                    <input
                      type="checkbox"
                      checked={editIsActive}
                      disabled={
                        isSavingUser || selectedUser.is_organization_owner
                      }
                      onChange={(event) => {
                        const nextIsActive = event.target.checked;

                        setEditIsActive(nextIsActive);
                        setEditUserMessage("");

                        if (!nextIsActive) {
                          setEditIsBillable(false);
                          setEditManagerPortalAccessEnabled(false);
                        }
                      }}
                    />

                    <span>
                      <strong>Active organization account</strong>
                      <small>
                        Inactive users cannot use their organization account or
                        assigned portal permissions.
                      </small>
                    </span>
                  </label>

                  <label className="user-access-option">
                    <input
                      type="checkbox"
                      checked={editIsBillable}
                      disabled={isSavingUser || !editIsActive}
                      onChange={(event) => {
                        const nextIsBillable = event.target.checked;

                        setEditIsBillable(nextIsBillable);
                        setEditUserMessage("");

                        if (!nextIsBillable) {
                          setEditPrimaryGroupId("");
                          setEditManagerPortalAccessEnabled(false);
                        }
                      }}
                    />

                    <span>
                      <strong>Everward app access</strong>
                      <small>
                        This account consumes one purchased seat while active.
                      </small>
                    </span>
                  </label>

                  {editRole === "group_manager" ? (
                    <label className="user-access-option">
                      <input
                        type="checkbox"
                        checked={editManagerPortalAccessEnabled}
                        disabled={isSavingUser || !editIsActive}
                        onChange={(event) => {
                          setEditManagerPortalAccessEnabled(
                            event.target.checked,
                          );
                          setEditUserMessage("");
                        }}
                      />

                      <span>
                        <strong>Manager portal access</strong>
                        <small>
                          Allows this Group Manager to access permitted
                          organization portal information.
                        </small>
                      </span>
                    </label>
                  ) : null}
                </div>

                <div className="user-edit-summary">
                  <div>
                    <span>After saving</span>
                    <strong>
                      {!editIsActive
                        ? "Inactive — no seat"
                        : editIsBillable
                          ? "Uses a seat"
                          : "Portal only"}
                    </strong>
                  </div>

                  <div>
                    <span>Available seats after saving</span>
                    <strong>
                      {Math.max(
                        0,
                        seatSummary.availableSeatCount +
                          (selectedUser.is_active && selectedUser.is_billable
                            ? 1
                            : 0) -
                          (editIsActive && editIsBillable ? 1 : 0),
                      )}
                    </strong>
                  </div>
                </div>

                <div className="user-edit-actions">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={isSavingUser}
                    onClick={() => {
                      void handleSaveUser();
                    }}
                  >
                    {isSavingUser ? "Saving changes..." : "Save user changes"}
                  </button>

                  <button
                    className="text-button"
                    type="button"
                    disabled={isSavingUser}
                    onClick={closeUserEditor}
                  >
                    Cancel
                  </button>
                </div>

                {editUserMessage ? (
                  <p className="form-message" role="status">
                    {editUserMessage}
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeView === "users" && !isAddingUsers && !selectedUser ? (
            <section className="dashboard-management-section">
              <div className="dashboard-section-heading">
                <div>
                  <p className="eyebrow">User management</p>
                  <h1>Organization users</h1>
                  <p>
                    Review seat availability and manage the people connected to
                    your organization.
                  </p>
                </div>

                <button
                  className="primary-button dashboard-action-button"
                  type="button"
                  onClick={() => {
                    setIsAddingUsers(true);
                    window.scrollTo({
                      top: 0,
                      behavior: "smooth",
                    });
                  }}
                >
                  Add users
                </button>
              </div>

              {isLoadingSeats ? (
                <p className="form-message">Loading seat information...</p>
              ) : seatMessage ? (
                <p className="form-message" role="alert">
                  {seatMessage}
                </p>
              ) : (
                <>
                  <div className="seat-summary">
                    <div>
                      <span>Purchased seats</span>
                      <strong>{seatSummary.purchasedSeatCount}</strong>
                    </div>

                    <div>
                      <span>Seats in use</span>
                      <strong>{seatSummary.usedSeatCount}</strong>
                    </div>

                    <div>
                      <span>Available seats</span>
                      <strong>{seatSummary.availableSeatCount}</strong>
                    </div>
                  </div>

                  {seatSummary.availableSeatCount === 0 ? (
                    <div className="dashboard-warning">
                      <strong>No app seats are available</strong>
                      <p>
                        Add another seat in Billing and Seats before adding
                        another app user.
                      </p>
                    </div>
                  ) : null}
                </>
              )}

              <section className="user-directory-section">
                <div className="dashboard-section-heading">
                  <div>
                    <p className="eyebrow">Directory</p>
                    <h2>Organization accounts</h2>
                  </div>
                </div>

                <div className="user-directory-filters">
                  <div className="setup-field">
                    <label htmlFor="user-directory-search">Search users</label>

                    <input
                      id="user-directory-search"
                      type="search"
                      value={userSearchQuery}
                      placeholder="Search by name, email, role, or group"
                      onChange={(event) => {
                        setUserSearchQuery(event.target.value);
                      }}
                    />
                  </div>

                  <div className="setup-field">
                    <label htmlFor="user-status-filter">Account status</label>

                    <select
                      id="user-status-filter"
                      value={userStatusFilter}
                      onChange={(event) => {
                        setUserStatusFilter(
                          event.target.value as UserStatusFilter,
                        );
                      }}
                    >
                      <option value="all">All accounts</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>

                  <div className="setup-field">
                    <label htmlFor="user-access-filter">Access</label>

                    <select
                      id="user-access-filter"
                      value={userAccessFilter}
                      onChange={(event) => {
                        setUserAccessFilter(
                          event.target.value as UserAccessFilter,
                        );
                      }}
                    >
                      <option value="all">All access types</option>
                      <option value="app_access">Everward app access</option>
                      <option value="portal_access">Portal access</option>
                      <option value="no_access">No current access</option>
                    </select>
                  </div>

                  <button
                    className="text-button user-filter-clear-button"
                    type="button"
                    disabled={
                      !userSearchQuery &&
                      userStatusFilter === "all" &&
                      userAccessFilter === "all"
                    }
                    onClick={() => {
                      setUserSearchQuery("");
                      setUserStatusFilter("all");
                      setUserAccessFilter("all");
                    }}
                  >
                    Clear filters
                  </button>
                </div>

                {isLoadingUsers ? (
                  <p className="form-message">Loading organization users...</p>
                ) : userDirectoryMessage ? (
                  <p className="form-message" role="alert">
                    {userDirectoryMessage}
                  </p>
                ) : organizationUsers.length === 0 ? (
                  <div className="dashboard-empty-state">
                    <strong>No organization users found</strong>
                    <p>
                      Add a user to begin building the organization directory.
                    </p>
                  </div>
                ) : filteredOrganizationUsers.length === 0 ? (
                  <div className="dashboard-empty-state">
                    <strong>No users match these filters</strong>
                    <p>
                      Change or clear the current search and filter selections.
                    </p>
                  </div>
                ) : (
                  <div className="user-directory-table-wrapper">
                    <table className="user-directory-table">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Role</th>
                          <th>Primary group</th>
                          <th>App seat</th>
                          <th>Portal access</th>
                          <th>Account status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>

                      <tbody>
                        {filteredOrganizationUsers.map((user) => (
                          <tr key={user.organization_user_id}>
                            <td>
                              <div className="user-directory-identity">
                                <strong>{user.full_name}</strong>
                                <span>{user.email_address}</span>

                                {user.is_organization_owner ? (
                                  <small>Organization owner</small>
                                ) : null}
                              </div>
                            </td>

                            <td>{formatRole(user.organization_role)}</td>

                            <td>
                              {user.primary_group_name ?? "No primary group"}
                            </td>

                            <td>
                              <span
                                className={
                                  user.is_billable
                                    ? "user-status-badge user-status-badge-seat"
                                    : "user-status-badge user-status-badge-portal"
                                }
                              >
                                {user.is_billable
                                  ? "Uses a seat"
                                  : "No app seat"}
                              </span>
                            </td>

                            <td>
                              <span
                                className={
                                  hasPortalAccess(user)
                                    ? "user-status-badge user-status-badge-active"
                                    : "user-status-badge user-status-badge-inactive"
                                }
                              >
                                {hasPortalAccess(user)
                                  ? user.organization_role === "group_manager"
                                    ? "Manager access"
                                    : "Enabled"
                                  : "None"}
                              </span>
                            </td>

                            <td>
                              <span
                                className={
                                  user.is_active
                                    ? "user-status-badge user-status-badge-active"
                                    : "user-status-badge user-status-badge-inactive"
                                }
                              >
                                {user.is_active ? "Active" : "Inactive"}
                              </span>
                            </td>

                            <td>
                              <button
                                className="text-button user-edit-button"
                                type="button"
                                onClick={() => {
                                  openUserEditor(user);
                                }}
                              >
                                Edit user
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </section>
          ) : null}

          {activeView === "groups" ? (
            <section className="dashboard-management-section">
              <div className="dashboard-section-heading">
                <div>
                  <p className="eyebrow">Organization structure</p>
                  <h1>Groups</h1>
                  <p>
                    Review departments, teams, locations, and their reporting
                    hierarchy.
                  </p>
                </div>
              </div>

              {groupMessage ? (
                <p className="form-message" role="alert">
                  {groupMessage}
                </p>
              ) : (
                <>
                  <div className="group-summary-grid">
                    <article className="dashboard-card">
                      <span className="dashboard-card-label">
                        Active groups
                      </span>
                      <strong>{organizationGroups.length}</strong>
                      <p>
                        Total active groups currently available in this
                        organization.
                      </p>
                    </article>

                    <article className="dashboard-card">
                      <span className="dashboard-card-label">
                        Top-level groups
                      </span>
                      <strong>{rootGroupCount}</strong>
                      <p>Groups that do not report beneath another group.</p>
                    </article>

                    <article className="dashboard-card">
                      <span className="dashboard-card-label">
                        Groups with app users
                      </span>
                      <strong>{assignedGroupCount}</strong>
                      <p>
                        Groups currently assigned as a primary group for at
                        least one active app user.
                      </p>
                    </article>
                  </div>

                  <section className="group-hierarchy-section">
                    <div className="group-directory-filters">
                      <div className="setup-field">
                        <label htmlFor="group-directory-search">
                          Search groups
                        </label>

                        <input
                          id="group-directory-search"
                          type="search"
                          value={groupSearchQuery}
                          placeholder="Search by group name"
                          onChange={(event) => {
                            setGroupSearchQuery(event.target.value);
                          }}
                        />
                      </div>

                      <button
                        className="text-button"
                        type="button"
                        disabled={!groupSearchQuery}
                        onClick={() => {
                          setGroupSearchQuery("");
                        }}
                      >
                        Clear filters
                      </button>
                    </div>

                    <div className="dashboard-section-heading">
                      <div>
                        <p className="eyebrow">Relevant structure</p>
                        <h2>Your visible group hierarchy</h2>
                        <p>
                          Expand or collapse groups to control how much of the
                          organization structure is visible.
                        </p>
                      </div>

                      <div className="group-hierarchy-actions">
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => {
                            setExpandedGroupIds(new Set());
                          }}
                        >
                          Collapse all
                        </button>

                        <button
                          className="text-button"
                          type="button"
                          onClick={() => {
                            setExpandedGroupIds(
                              new Set(
                                organizationGroups
                                  .filter((group) =>
                                    organizationGroups.some(
                                      (possibleChild) =>
                                        possibleChild.parent_group_id ===
                                        group.id,
                                    ),
                                  )
                                  .map((group) => group.id),
                              ),
                            );
                          }}
                        >
                          Expand all
                        </button>
                      </div>
                    </div>

                    {organizationGroupHierarchy.length === 0 ? (
                      <div className="dashboard-empty-state">
                        <strong>
                          {organizationGroups.length === 0
                            ? "No active groups found"
                            : "No groups match these filters"}
                        </strong>

                        <p>
                          {organizationGroups.length === 0
                            ? "Organization groups will appear here after they are created."
                            : "Change or clear the current group filters."}
                        </p>
                      </div>
                    ) : (
                      <div className="group-hierarchy-list">
                        {organizationGroupHierarchy.map((group) => {
                          const minimumVisibleDepth = Math.min(
                            ...organizationGroupHierarchy.map(
                              (visibleGroup) => visibleGroup.depth,
                            ),
                          );

                          const visibleDepth =
                            group.depth - minimumVisibleDepth;
                          const parentGroup = organizationGroups.find(
                            (possibleParent) =>
                              possibleParent.id === group.parent_group_id,
                          );

                          const groupUserCount = organizationUsers.filter(
                            (user) =>
                              user.is_active &&
                              user.is_billable &&
                              user.primary_group_id === group.id,
                          ).length;

                          const childGroupCount = organizationGroups.filter(
                            (possibleChild) =>
                              possibleChild.parent_group_id === group.id,
                          ).length;

                          const isExpanded = expandedGroupIds.has(group.id);

                          return (
                            <article
                              key={group.id}
                              className="group-hierarchy-row"
                              style={{
                                marginLeft: `${
                                  Math.min(visibleDepth, 5) * 28
                                }px`,
                              }}
                            >
                              <div className="group-hierarchy-marker">
                                <span>{group.depth + 1}</span>
                              </div>

                              <div className="group-hierarchy-details">
                                <strong>{group.name}</strong>

                                <span>
                                  {parentGroup
                                    ? `Reports to ${parentGroup.name}`
                                    : "Top-level group"}
                                </span>
                              </div>

                              <div className="group-hierarchy-counts">
                                <div>
                                  <span>App users</span>
                                  <strong>{groupUserCount}</strong>
                                </div>

                                <div>
                                  <span>Child groups</span>
                                  <strong>{childGroupCount}</strong>
                                </div>

                                {childGroupCount > 0 ? (
                                  <button
                                    className="group-hierarchy-toggle"
                                    type="button"
                                    aria-expanded={isExpanded}
                                    onClick={() => {
                                      toggleGroupExpansion(group.id);
                                    }}
                                  >
                                    {isExpanded
                                      ? "Collapse"
                                      : `Expand (${childGroupCount})`}
                                  </button>
                                ) : null}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </>
              )}
            </section>
          ) : null}

          {activeView === "billing" ? (
            <section className="dashboard-management-section">
              <div className="dashboard-section-heading">
                <div>
                  <p className="eyebrow">Subscription management</p>
                  <h1>Billing and Seats</h1>
                  <p>
                    Manage the organization subscription, app seats, payment
                    method, invoices, and cancellation.
                  </p>
                </div>
              </div>

              <OrganizationBillingManager
                organizationId={organizationId}
              />

            </section>
          ) : null}

          {activeView === "analyze" ? (
            <section className="dashboard-management-section">
              <div className="dashboard-section-heading">
                <div>
                  <p className="eyebrow">Leadership intelligence</p>
                  <h1>Analyze Company Data</h1>
                  <p>
                    Ask Everward to identify patterns, risks, opportunities,
                    performance barriers, and concrete leadership actions using
                    the organization data you are authorized to access.
                  </p>
                </div>
              </div>

              {isLoadingUsers ? (
                <p className="form-message">
                  Loading available people and groups...
                </p>
              ) : userDirectoryMessage || groupMessage ? (
                <p className="form-message" role="alert">
                  {userDirectoryMessage || groupMessage}
                </p>
              ) : (
                <>
                  <section className="report-filter-section">
                    <div className="dashboard-section-heading">
                      <div>
                        <p className="eyebrow">Analysis scope</p>
                        <h2>Select people or groups</h2>
                        <p>
                          Leave all selections empty to analyze the whole
                          organization.
                        </p>
                      </div>

                      <button
                        className="text-button"
                        type="button"
                        disabled={
                          selectedReportUserIds.size === 0 &&
                          selectedReportGroupIds.size === 0
                        }
                        onClick={selectWholeOrganizationReport}
                      >
                        Use whole organization
                      </button>
                    </div>

                    <div className="report-scope-summary">
                      <span>Current analysis scope</span>
                      <strong>{reportScopeLabel}</strong>
                    </div>

                    <div className="report-filter-grid">
                      <section className="report-selection-panel">
                        <div className="report-selection-heading">
                          <div>
                            <strong>Individuals</strong>
                            <span>{selectedReportUserIds.size} selected</span>
                          </div>

                          <button
                            className="text-button"
                            type="button"
                            disabled={selectedReportUserIds.size === 0}
                            onClick={() => {
                              setSelectedReportUserIds(new Set());
                              setReportMessage("");
                            }}
                          >
                            Clear
                          </button>
                        </div>

                        {reportableOrganizationUsers.length === 0 ? (
                          <p className="report-selection-empty">
                            No active app users are available.
                          </p>
                        ) : (
                          <div className="report-checkbox-list">
                            {reportableOrganizationUsers.map((user) => (
                              <label
                                key={user.user_id}
                                className="report-checkbox-option"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedReportUserIds.has(
                                    user.user_id,
                                  )}
                                  disabled={isGroupReportMode}
                                  onChange={() => {
                                    toggleReportUser(user.user_id);
                                  }}
                                />

                                <span>
                                  <strong>{user.full_name}</strong>
                                  <small>
                                    {user.primary_group_name ??
                                      "No primary group"}
                                  </small>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </section>

                      <section className="report-selection-panel">
                        <div className="report-selection-heading">
                          <div>
                            <strong>Groups</strong>
                            <span>{selectedReportGroupIds.size} selected</span>
                          </div>

                          <button
                            className="text-button"
                            type="button"
                            disabled={selectedReportGroupIds.size === 0}
                            onClick={() => {
                              setSelectedReportGroupIds(new Set());
                              setReportMessage("");
                            }}
                          >
                            Clear
                          </button>
                        </div>

                        {reportGroupHierarchy.length === 0 ? (
                          <p className="report-selection-empty">
                            No active groups are available.
                          </p>
                        ) : (
                          <div className="report-checkbox-list">
                            {reportGroupHierarchy.map((group) => (
                              <label
                                key={group.id}
                                className="report-checkbox-option"
                                style={{
                                  paddingLeft: `${
                                    14 + Math.min(group.depth, 5) * 20
                                  }px`,
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedReportGroupIds.has(group.id)}
                                  disabled={isIndividualReportMode}
                                  onChange={() => {
                                    toggleReportGroup(group.id);
                                  }}
                                />

                                <span>
                                  <strong>{group.name}</strong>
                                  <small>
                                    {group.depth === 0
                                      ? "Top-level group"
                                      : `Level ${group.depth + 1}`}
                                  </small>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </section>
                    </div>
                  </section>

                  {role === "organization_admin" ||
                  role === "user_admin" ||
                  role === "group_manager" ? (
                    <OrganizationDataAi
                      organizationId={organizationId}
                      scopeLabel={reportScopeLabel}
                      selectedUserIds={Array.from(selectedReportUserIds)}
                      selectedGroupIds={Array.from(selectedReportGroupIds)}
                      reportDetailSearchQuery=""
                    />
                  ) : null}
                </>
              )}
            </section>
          ) : null}

          {activeView === "reports" ? (
            <section className="dashboard-management-section">
              <div className="dashboard-section-heading">
                <div>
                  <p className="eyebrow">Organization reporting</p>
                  <h1>Reports</h1>
                  <p>
                    Review Everward usage, active priorities, retired
                    priorities, decisions, and Trackables.
                  </p>
                </div>
              </div>

              <section className="report-filter-section">
                <div className="dashboard-section-heading">
                  <div>
                    <p className="eyebrow">Organization AI credits</p>
                    <h2>Current billing period</h2>
                    <p>
                      Organization-wide AI credit availability and renewal
                      information.
                    </p>
                  </div>
                </div>

                {isLoadingOrganizationAiCredits ? (
                  <p className="form-message">
                    Loading organization AI credits...
                  </p>
                ) : organizationAiCreditMessage ? (
                  <p className="form-message" role="alert">
                    {organizationAiCreditMessage}
                  </p>
                ) : organizationAiCreditSummary ? (
                  <div className="usage-metric-grid">
                    <article className="usage-metric-card">
                      <span>AI credits available</span>
                      <strong>
                        {organizationAiCreditSummary.ai_credits_available}
                      </strong>
                      <small>Organization pool</small>
                    </article>

                    <article className="usage-metric-card">
                      <span>AI credits used</span>
                      <strong>
                        {organizationAiCreditSummary.ai_credits_used}
                      </strong>
                      <small>Current billing period</small>
                    </article>

                    <article className="usage-metric-card">
                      <span>AI credit renewal date</span>
                      <strong>
                        {formatReportDate(
                          organizationAiCreditSummary.ai_credit_renewal_date,
                        )}
                      </strong>
                      <small>Organization pool resets</small>
                    </article>
                  </div>
                ) : null}
              </section>

              {isLoadingUsers ? (
                <p className="form-message">
                  Loading organization reporting options...
                </p>
              ) : userDirectoryMessage || groupMessage ? (
                <p className="form-message" role="alert">
                  {userDirectoryMessage || groupMessage}
                </p>
              ) : (
                <>
                  <section className="report-filter-section">
                    <div className="dashboard-section-heading">
                      <div>
                        <p className="eyebrow">Report scope</p>
                        <h2>Select people or groups</h2>
                        <p>
                          Leave all selections empty to report on the whole
                          organization.
                        </p>
                      </div>

                      <button
                        className="text-button"
                        type="button"
                        disabled={
                          selectedReportUserIds.size === 0 &&
                          selectedReportGroupIds.size === 0
                        }
                        onClick={selectWholeOrganizationReport}
                      >
                        Use whole organization
                      </button>
                    </div>

                    <div className="report-scope-summary">
                      <span>Current scope</span>
                      <strong>{reportScopeLabel}</strong>
                    </div>

                    <div className="report-filter-grid">
                      <section className="report-selection-panel">
                        <div className="report-selection-heading">
                          <div>
                            <strong>Individuals</strong>
                            <span>{selectedReportUserIds.size} selected</span>
                          </div>

                          <button
                            className="text-button"
                            type="button"
                            disabled={selectedReportUserIds.size === 0}
                            onClick={() => {
                              setSelectedReportUserIds(new Set());
                              setHasLoadedReports(false);
                              setReportMessage("");
                            }}
                          >
                            Clear
                          </button>
                        </div>

                        {reportableOrganizationUsers.length === 0 ? (
                          <p className="report-selection-empty">
                            No active app users are available.
                          </p>
                        ) : (
                          <div className="report-checkbox-list">
                            {reportableOrganizationUsers.map((user) => (
                              <label
                                key={user.user_id}
                                className="report-checkbox-option"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedReportUserIds.has(
                                    user.user_id,
                                  )}
                                  disabled={isGroupReportMode}
                                  onChange={() => {
                                    toggleReportUser(user.user_id);
                                  }}
                                />

                                <span>
                                  <strong>{user.full_name}</strong>
                                  <small>
                                    {user.primary_group_name ??
                                      "No primary group"}
                                  </small>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </section>

                      <section className="report-selection-panel">
                        <div className="report-selection-heading">
                          <div>
                            <strong>Groups</strong>
                            <span>{selectedReportGroupIds.size} selected</span>
                          </div>

                          <button
                            className="text-button"
                            type="button"
                            disabled={selectedReportGroupIds.size === 0}
                            onClick={() => {
                              setSelectedReportGroupIds(new Set());
                              setHasLoadedReports(false);
                              setReportMessage("");
                            }}
                          >
                            Clear
                          </button>
                        </div>

                        {reportGroupHierarchy.length === 0 ? (
                          <p className="report-selection-empty">
                            No active groups are available.
                          </p>
                        ) : (
                          <div className="report-checkbox-list">
                            {reportGroupHierarchy.map((group) => (
                              <label
                                key={group.id}
                                className="report-checkbox-option"
                                style={{
                                  paddingLeft: `${
                                    14 + Math.min(group.depth, 5) * 20
                                  }px`,
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedReportGroupIds.has(group.id)}
                                  disabled={isIndividualReportMode}
                                  onChange={() => {
                                    toggleReportGroup(group.id);
                                  }}
                                />

                                <span>
                                  <strong>{group.name}</strong>
                                  <small>
                                    {group.depth === 0
                                      ? "Top-level group"
                                      : `Level ${group.depth + 1}`}
                                  </small>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </section>
                    </div>

                    <div className="report-filter-actions">
                      <button
                        className="primary-button"
                        type="button"
                        disabled={isLoadingReports}
                        onClick={() => {
                          void loadOrganizationReports();
                        }}
                      >
                        {isLoadingReports ? "Loading report..." : "Run report"}
                      </button>
                    </div>

                    {reportMessage ? (
                      <p className="form-message" role="alert">
                        {reportMessage}
                      </p>
                    ) : null}
                  </section>

                  {isLoadingReports ? (
                    <p className="form-message">
                      Loading Everward usage and priority details...
                    </p>
                  ) : hasLoadedReports && usageReport ? (
                    <>
                      <section className="report-results-heading">
                        <div>
                          <p className="eyebrow">Report results</p>
                          <h2>{reportScopeLabel}</h2>
                          <p>
                            Data includes {usageReport.selected_user_count}{" "}
                            selected{" "}
                            {usageReport.selected_user_count === 1
                              ? "person"
                              : "people"}
                            .
                          </p>
                        </div>
                      </section>

                      {showComparisonMatrix ? (
                        <section className="report-comparison-section">
                          <div className="dashboard-section-heading">
                            <div>
                              <p className="eyebrow">Usage comparison</p>

                              <h2>
                                {selectedReportUserIds.size > 1
                                  ? "Individual comparison"
                                  : "Group comparison"}
                              </h2>

                              <p>
                                Compare Everward usage across the selected{" "}
                                {selectedReportUserIds.size > 1
                                  ? "individuals"
                                  : "groups"}
                                .
                              </p>
                            </div>

                            <button
                              className="secondary-button"
                              type="button"
                              disabled={comparisonReportRows.length === 0}
                              onClick={exportComparisonReportCsv}
                            >
                              Export comparison CSV
                            </button>
                          </div>

                          <div className="report-comparison-scroll">
                            <table className="report-comparison-table">
                              <thead>
                                <tr>
                                  <th>
                                    {selectedReportUserIds.size > 1
                                      ? "Individual"
                                      : "Group"}
                                  </th>
                                  <th>People included</th>
                                  <th>Priorities set</th>
                                  <th>Decisions made</th>
                                  <th>Trackables</th>
                                  <th>AI credits used</th>
                                </tr>
                              </thead>

                              <tbody>
                                {comparisonReportRows.map((row) => (
                                  <tr key={row.id}>
                                    <th scope="row">{row.name}</th>
                                    <td>{row.selected_user_count}</td>
                                    <td>{row.priority_count}</td>
                                    <td>{row.decision_count}</td>
                                    <td>{row.trackable_count}</td>
                                    <td>{row.ai_credits_used}</td>
                                  </tr>
                                ))}
                              </tbody>

                              <tfoot>
                                <tr>
                                  <th scope="row">Total</th>
                                  <td>{usageReport.selected_user_count}</td>
                                  <td>{usageReport.priority_count}</td>
                                  <td>{usageReport.decision_count}</td>
                                  <td>{usageReport.trackable_count}</td>
                                  <td>{usageReport.ai_credits_used}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </section>
                      ) : (
                        <div className="usage-metric-grid">
                          <article className="usage-metric-card">
                            <span>Priorities set</span>
                            <strong>{usageReport.priority_count}</strong>
                          </article>

                          <article className="usage-metric-card">
                            <span>Decisions made</span>
                            <strong>{usageReport.decision_count}</strong>
                          </article>

                          <article className="usage-metric-card">
                            <span>Trackables</span>
                            <strong>{usageReport.trackable_count}</strong>
                          </article>

                          <article className="usage-metric-card">
                            <span>AI credits used</span>
                            <strong>{usageReport.ai_credits_used}</strong>
                          </article>
                        </div>
                      )}

                      <section className="report-filter-section">
                        <div className="dashboard-section-heading">
                          <div>
                            <p className="eyebrow">Search report details</p>
                            <h2>Find specific information</h2>
                            <p>
                              Search employees, groups, priorities, decisions,
                              Trackables, entries, and AI analysis.
                            </p>
                          </div>

                          <button
                            className="text-button"
                            type="button"
                            disabled={!reportDetailSearchQuery}
                            onClick={() => {
                              setReportDetailSearchQuery("");
                            }}
                          >
                            Clear search
                          </button>
                        </div>

                        <div className="setup-field">
                          <label htmlFor="report-detail-search">
                            Search details
                          </label>

                          <input
                            id="report-detail-search"
                            type="search"
                            value={reportDetailSearchQuery}
                            placeholder="Search all report details"
                            onChange={(event) => {
                              setReportDetailSearchQuery(event.target.value);
                            }}
                          />
                        </div>

                        {normalizedReportDetailSearchQuery ? (
                          <p className="form-message" role="status">
                            Showing {filteredActivePriorityReport.length} active
                            and {filteredRetiredPriorityReport.length} retired
                            priority results.
                          </p>
                        ) : null}
                      </section>

                      <section className="priority-detail-report-section">
                        <div className="dashboard-section-heading">
                          <div>
                            <p className="eyebrow">Details report</p>
                            <h2>Active priorities</h2>
                            <p>
                              Active priorities with their connected decisions
                              and trackables.
                            </p>
                          </div>

                          <div className="report-section-actions">
                            <strong className="report-section-total">
                              {filteredActivePriorityReport.length}
                            </strong>

                            <button
                              className="secondary-button"
                              type="button"
                              disabled={
                                filteredActivePriorityReport.length === 0
                              }
                              onClick={() => {
                                exportPriorityReportCsv("active");
                              }}
                            >
                              {normalizedReportDetailSearchQuery
                                ? "Export filtered active CSV"
                                : "Export active priorities CSV"}
                            </button>
                          </div>
                        </div>

                        {filteredActivePriorityReport.length === 0 ? (
                          <div className="dashboard-empty-state">
                            <strong>
                              {normalizedReportDetailSearchQuery
                                ? "No active priorities match this search"
                                : "No active priorities found"}
                            </strong>
                            <p>
                              {normalizedReportDetailSearchQuery
                                ? "Change or clear the detail search to see additional active priorities."
                                : "No active priorities match the selected report scope."}
                            </p>
                          </div>
                        ) : (
                          <div className="priority-report-list">
                            {filteredActivePriorityReport.map((priority) => (
                              <details
                                key={priority.priority_id}
                                className="priority-report-item"
                                open={Boolean(
                                  normalizedReportDetailSearchQuery,
                                )}
                              >
                                <summary>
                                  <div className="priority-report-summary">
                                    <div>
                                      <strong>{priority.priority_title}</strong>

                                      <span>
                                        {priority.user_full_name}
                                        {priority.group_name
                                          ? ` • ${priority.group_name}`
                                          : ""}
                                      </span>
                                    </div>

                                    <div className="priority-report-counts">
                                      <span>
                                        {
                                          priority.decisions.filter(
                                            decisionMatchesDetailSearch,
                                          ).length
                                        }{" "}
                                        {priority.decisions.filter(
                                          decisionMatchesDetailSearch,
                                        ).length === 1
                                          ? "decision"
                                          : "decisions"}
                                      </span>

                                      <span>
                                        {
                                          priority.trackables.filter(
                                            trackableMatchesDetailSearch,
                                          ).length
                                        }{" "}
                                        {priority.trackables.filter(
                                          trackableMatchesDetailSearch,
                                        ).length === 1
                                          ? "trackable"
                                          : "trackables"}
                                      </span>
                                    </div>
                                  </div>
                                </summary>

                                <div className="priority-report-content">
                                  {priority.priority_description ? (
                                    <p className="priority-report-description">
                                      {priority.priority_description}
                                    </p>
                                  ) : null}

                                  <div className="priority-report-metadata">
                                    <span>
                                      Created{" "}
                                      {formatReportDate(
                                        priority.priority_created_at,
                                      )}
                                    </span>

                                    <span>{priority.user_email}</span>
                                  </div>

                                  <section className="priority-report-subsection">
                                    <h3>Decisions</h3>

                                    {priority.decisions.filter(
                                      decisionMatchesDetailSearch,
                                    ).length === 0 ? (
                                      <p>
                                        {normalizedReportDetailSearchQuery
                                          ? "No decisions match this search."
                                          : "No decisions recorded."}
                                      </p>
                                    ) : (
                                      <div className="priority-report-record-list">
                                        {priority.decisions
                                          .filter(decisionMatchesDetailSearch)
                                          .map((decision) => {
                                            const decisionAnalyses = (
                                              decisionAnalysesByDecisionId[
                                                decision.id
                                              ] ?? []
                                            ).filter(
                                              analysisMatchesDetailSearch,
                                            );

                                            return (
                                              <article key={decision.id}>
                                                <div>
                                                  <strong>
                                                    {decision.title}
                                                  </strong>

                                                  <span>
                                                    {formatReportDate(
                                                      decision.created_at,
                                                    )}
                                                  </span>
                                                </div>

                                                {decision.description ? (
                                                  <p>{decision.description}</p>
                                                ) : null}

                                                {decisionAnalyses.length ===
                                                0 ? (
                                                  <p>
                                                    No AI analysis recorded.
                                                  </p>
                                                ) : (
                                                  <div className="decision-analysis-list">
                                                    {decisionAnalyses.map(
                                                      (analysis) => (
                                                        <div
                                                          key={
                                                            analysis.analysis_id
                                                          }
                                                          className="decision-analysis-record"
                                                        >
                                                          <div>
                                                            <strong>
                                                              {analysis.analysis_label ||
                                                                "AI analysis"}
                                                            </strong>

                                                            <span>
                                                              {formatReportDate(
                                                                analysis.analysis_created_at,
                                                              )}
                                                            </span>
                                                          </div>

                                                          {analysis.analysis_summary ? (
                                                            <p>
                                                              {
                                                                analysis.analysis_summary
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.alignment_signal ? (
                                                            <p>
                                                              <b>
                                                                Alignment
                                                                signal:
                                                              </b>{" "}
                                                              {
                                                                analysis.alignment_signal
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.priority_alignment ? (
                                                            <p>
                                                              <b>
                                                                Priority
                                                                alignment:
                                                              </b>{" "}
                                                              {
                                                                analysis.priority_alignment
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.risk_tradeoff ? (
                                                            <p>
                                                              <b>
                                                                Risk or
                                                                tradeoff:
                                                              </b>{" "}
                                                              {
                                                                analysis.risk_tradeoff
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.better_next_decision ? (
                                                            <p>
                                                              <b>
                                                                Better next
                                                                decision:
                                                              </b>{" "}
                                                              {
                                                                analysis.better_next_decision
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.suggested_trackable ? (
                                                            <p>
                                                              <b>
                                                                Suggested
                                                                Trackable:
                                                              </b>{" "}
                                                              {
                                                                analysis.suggested_trackable
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.next_step ? (
                                                            <p>
                                                              <b>Next step:</b>{" "}
                                                              {
                                                                analysis.next_step
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.analysis_note ? (
                                                            <p>
                                                              <b>Note:</b>{" "}
                                                              {
                                                                analysis.analysis_note
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.insight_level ? (
                                                            <p>
                                                              <b>
                                                                Insight level:
                                                              </b>{" "}
                                                              {
                                                                analysis.insight_level
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.decision_pattern_read ? (
                                                            <p>
                                                              <b>
                                                                Decision
                                                                pattern:
                                                              </b>{" "}
                                                              {
                                                                analysis.decision_pattern_read
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.priority_pressure ? (
                                                            <p>
                                                              <b>
                                                                Priority
                                                                pressure:
                                                              </b>{" "}
                                                              {
                                                                analysis.priority_pressure
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.execution_risk ? (
                                                            <p>
                                                              <b>
                                                                Execution risk:
                                                              </b>{" "}
                                                              {
                                                                analysis.execution_risk
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.highest_leverage_followup ? (
                                                            <p>
                                                              <b>
                                                                Highest-leverage
                                                                follow-up:
                                                              </b>{" "}
                                                              {
                                                                analysis.highest_leverage_followup
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.evidence_quality ? (
                                                            <p>
                                                              <b>
                                                                Evidence
                                                                quality:
                                                              </b>{" "}
                                                              {
                                                                analysis.evidence_quality
                                                              }
                                                            </p>
                                                          ) : null}
                                                        </div>
                                                      ),
                                                    )}
                                                  </div>
                                                )}
                                              </article>
                                            );
                                          })}
                                      </div>
                                    )}
                                  </section>

                                  <section className="priority-report-subsection">
                                    <h3>Trackables</h3>

                                    {priority.trackables.filter(
                                      trackableMatchesDetailSearch,
                                    ).length === 0 ? (
                                      <p>
                                        {normalizedReportDetailSearchQuery
                                          ? "No Trackables match this search."
                                          : "No Trackables recorded."}
                                      </p>
                                    ) : (
                                      <div className="priority-report-record-list">
                                        {priority.trackables
                                          .filter(trackableMatchesDetailSearch)
                                          .map((trackable) => {
                                            const trackableEntries = (
                                              trackableEntriesByTrackableId[
                                                trackable.id
                                              ] ?? []
                                            ).filter(entryMatchesDetailSearch);

                                            return (
                                              <article key={trackable.id}>
                                                <div>
                                                  <strong>
                                                    {trackable.title}
                                                  </strong>

                                                  <span>
                                                    {trackable.unit ??
                                                      "No unit"}
                                                  </span>
                                                </div>

                                                {trackable.description ? (
                                                  <p>{trackable.description}</p>
                                                ) : null}

                                                <p>
                                                  Status:{" "}
                                                  {formatRole(trackable.status)}
                                                </p>

                                                {trackableEntries.length ===
                                                0 ? (
                                                  <p>
                                                    No Trackable entries
                                                    recorded.
                                                  </p>
                                                ) : (
                                                  <div className="trackable-entry-list">
                                                    {trackableEntries.map(
                                                      (entry) => (
                                                        <div
                                                          key={entry.entry_id}
                                                          className="trackable-entry-row"
                                                        >
                                                          <div>
                                                            <strong>
                                                              {
                                                                entry.entry_value
                                                              }
                                                            </strong>

                                                            <span>
                                                              {formatReportDate(
                                                                entry.entry_recorded_at,
                                                              )}
                                                            </span>
                                                          </div>

                                                          {entry.entry_note ? (
                                                            <p>
                                                              {entry.entry_note}
                                                            </p>
                                                          ) : null}
                                                        </div>
                                                      ),
                                                    )}
                                                  </div>
                                                )}
                                              </article>
                                            );
                                          })}
                                      </div>
                                    )}
                                  </section>
                                </div>
                              </details>
                            ))}
                          </div>
                        )}
                      </section>

                      <section className="priority-detail-report-section">
                        <div className="dashboard-section-heading">
                          <div>
                            <p className="eyebrow">Details report</p>
                            <h2>Retired priorities</h2>
                            <p>
                              Retired priorities with their connected decisions
                              and trackables.
                            </p>
                          </div>

                          <div className="report-section-actions">
                            <strong className="report-section-total">
                              {filteredRetiredPriorityReport.length}
                            </strong>

                            <button
                              className="secondary-button"
                              type="button"
                              disabled={
                                filteredRetiredPriorityReport.length === 0
                              }
                              onClick={() => {
                                exportPriorityReportCsv("retired");
                              }}
                            >
                              {normalizedReportDetailSearchQuery
                                ? "Export filtered retired CSV"
                                : "Export retired priorities CSV"}
                            </button>
                          </div>
                        </div>

                        {filteredRetiredPriorityReport.length === 0 ? (
                          <div className="dashboard-empty-state">
                            <strong>
                              {normalizedReportDetailSearchQuery
                                ? "No retired priorities match this search"
                                : "No retired priorities found"}
                            </strong>
                            <p>
                              {normalizedReportDetailSearchQuery
                                ? "Change or clear the detail search to see additional retired priorities."
                                : "No retired priorities match the selected report scope."}
                            </p>
                          </div>
                        ) : (
                          <div className="priority-report-list">
                            {filteredRetiredPriorityReport.map((priority) => (
                              <details
                                key={priority.priority_id}
                                className="priority-report-item"
                                open={Boolean(
                                  normalizedReportDetailSearchQuery,
                                )}
                              >
                                <summary>
                                  <div className="priority-report-summary">
                                    <div>
                                      <strong>{priority.priority_title}</strong>

                                      <span>
                                        {priority.user_full_name}
                                        {priority.group_name
                                          ? ` • ${priority.group_name}`
                                          : ""}
                                      </span>
                                    </div>

                                    <div className="priority-report-counts">
                                      <span>
                                        {
                                          priority.decisions.filter(
                                            decisionMatchesDetailSearch,
                                          ).length
                                        }{" "}
                                        {priority.decisions.filter(
                                          decisionMatchesDetailSearch,
                                        ).length === 1
                                          ? "decision"
                                          : "decisions"}
                                      </span>

                                      <span>
                                        {
                                          priority.trackables.filter(
                                            trackableMatchesDetailSearch,
                                          ).length
                                        }{" "}
                                        {priority.trackables.filter(
                                          trackableMatchesDetailSearch,
                                        ).length === 1
                                          ? "trackable"
                                          : "trackables"}
                                      </span>
                                    </div>
                                  </div>
                                </summary>

                                <div className="priority-report-content">
                                  {priority.priority_description ? (
                                    <p className="priority-report-description">
                                      {priority.priority_description}
                                    </p>
                                  ) : null}

                                  <div className="priority-report-metadata">
                                    <span>
                                      Retired{" "}
                                      {formatReportDate(
                                        priority.priority_retired_at,
                                      )}
                                    </span>

                                    <span>{priority.user_email}</span>
                                  </div>

                                  <section className="priority-report-subsection">
                                    <h3>Decisions</h3>

                                    {priority.decisions.filter(
                                      decisionMatchesDetailSearch,
                                    ).length === 0 ? (
                                      <p>
                                        {normalizedReportDetailSearchQuery
                                          ? "No decisions match this search."
                                          : "No decisions recorded."}
                                      </p>
                                    ) : (
                                      <div className="priority-report-record-list">
                                        {priority.decisions
                                          .filter(decisionMatchesDetailSearch)
                                          .map((decision) => {
                                            const decisionAnalyses = (
                                              decisionAnalysesByDecisionId[
                                                decision.id
                                              ] ?? []
                                            ).filter(
                                              analysisMatchesDetailSearch,
                                            );

                                            return (
                                              <article key={decision.id}>
                                                <div>
                                                  <strong>
                                                    {decision.title}
                                                  </strong>

                                                  <span>
                                                    {formatReportDate(
                                                      decision.created_at,
                                                    )}
                                                  </span>
                                                </div>

                                                {decision.description ? (
                                                  <p>{decision.description}</p>
                                                ) : null}

                                                {decisionAnalyses.length ===
                                                0 ? (
                                                  <p>
                                                    No AI analysis recorded.
                                                  </p>
                                                ) : (
                                                  <div className="decision-analysis-list">
                                                    {decisionAnalyses.map(
                                                      (analysis) => (
                                                        <div
                                                          key={
                                                            analysis.analysis_id
                                                          }
                                                          className="decision-analysis-record"
                                                        >
                                                          <div>
                                                            <strong>
                                                              {analysis.analysis_label ||
                                                                "AI analysis"}
                                                            </strong>

                                                            <span>
                                                              {formatReportDate(
                                                                analysis.analysis_created_at,
                                                              )}
                                                            </span>
                                                          </div>

                                                          {analysis.analysis_summary ? (
                                                            <p>
                                                              {
                                                                analysis.analysis_summary
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.alignment_signal ? (
                                                            <p>
                                                              <b>
                                                                Alignment
                                                                signal:
                                                              </b>{" "}
                                                              {
                                                                analysis.alignment_signal
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.priority_alignment ? (
                                                            <p>
                                                              <b>
                                                                Priority
                                                                alignment:
                                                              </b>{" "}
                                                              {
                                                                analysis.priority_alignment
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.risk_tradeoff ? (
                                                            <p>
                                                              <b>
                                                                Risk or
                                                                tradeoff:
                                                              </b>{" "}
                                                              {
                                                                analysis.risk_tradeoff
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.better_next_decision ? (
                                                            <p>
                                                              <b>
                                                                Better next
                                                                decision:
                                                              </b>{" "}
                                                              {
                                                                analysis.better_next_decision
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.suggested_trackable ? (
                                                            <p>
                                                              <b>
                                                                Suggested
                                                                Trackable:
                                                              </b>{" "}
                                                              {
                                                                analysis.suggested_trackable
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.next_step ? (
                                                            <p>
                                                              <b>Next step:</b>{" "}
                                                              {
                                                                analysis.next_step
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.analysis_note ? (
                                                            <p>
                                                              <b>Note:</b>{" "}
                                                              {
                                                                analysis.analysis_note
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.insight_level ? (
                                                            <p>
                                                              <b>
                                                                Insight level:
                                                              </b>{" "}
                                                              {
                                                                analysis.insight_level
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.decision_pattern_read ? (
                                                            <p>
                                                              <b>
                                                                Decision
                                                                pattern:
                                                              </b>{" "}
                                                              {
                                                                analysis.decision_pattern_read
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.priority_pressure ? (
                                                            <p>
                                                              <b>
                                                                Priority
                                                                pressure:
                                                              </b>{" "}
                                                              {
                                                                analysis.priority_pressure
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.execution_risk ? (
                                                            <p>
                                                              <b>
                                                                Execution risk:
                                                              </b>{" "}
                                                              {
                                                                analysis.execution_risk
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.highest_leverage_followup ? (
                                                            <p>
                                                              <b>
                                                                Highest-leverage
                                                                follow-up:
                                                              </b>{" "}
                                                              {
                                                                analysis.highest_leverage_followup
                                                              }
                                                            </p>
                                                          ) : null}

                                                          {analysis.evidence_quality ? (
                                                            <p>
                                                              <b>
                                                                Evidence
                                                                quality:
                                                              </b>{" "}
                                                              {
                                                                analysis.evidence_quality
                                                              }
                                                            </p>
                                                          ) : null}
                                                        </div>
                                                      ),
                                                    )}
                                                  </div>
                                                )}
                                              </article>
                                            );
                                          })}
                                      </div>
                                    )}
                                  </section>

                                  <section className="priority-report-subsection">
                                    <h3>Trackables</h3>

                                    {priority.trackables.filter(
                                      trackableMatchesDetailSearch,
                                    ).length === 0 ? (
                                      <p>
                                        {normalizedReportDetailSearchQuery
                                          ? "No Trackables match this search."
                                          : "No Trackables recorded."}
                                      </p>
                                    ) : (
                                      <div className="priority-report-record-list">
                                        {priority.trackables
                                          .filter(trackableMatchesDetailSearch)
                                          .map((trackable) => {
                                            const trackableEntries = (
                                              trackableEntriesByTrackableId[
                                                trackable.id
                                              ] ?? []
                                            ).filter(entryMatchesDetailSearch);

                                            return (
                                              <article key={trackable.id}>
                                                <div>
                                                  <strong>
                                                    {trackable.title}
                                                  </strong>

                                                  <span>
                                                    {trackable.unit ??
                                                      "No unit"}
                                                  </span>
                                                </div>

                                                {trackable.description ? (
                                                  <p>{trackable.description}</p>
                                                ) : null}

                                                <p>
                                                  Status:{" "}
                                                  {formatRole(trackable.status)}
                                                </p>

                                                {trackableEntries.length ===
                                                0 ? (
                                                  <p>
                                                    No Trackable entries
                                                    recorded.
                                                  </p>
                                                ) : (
                                                  <div className="trackable-entry-list">
                                                    {trackableEntries.map(
                                                      (entry) => (
                                                        <div
                                                          key={entry.entry_id}
                                                          className="trackable-entry-row"
                                                        >
                                                          <div>
                                                            <strong>
                                                              {
                                                                entry.entry_value
                                                              }
                                                            </strong>

                                                            <span>
                                                              {formatReportDate(
                                                                entry.entry_recorded_at,
                                                              )}
                                                            </span>
                                                          </div>

                                                          {entry.entry_note ? (
                                                            <p>
                                                              {entry.entry_note}
                                                            </p>
                                                          ) : null}
                                                        </div>
                                                      ),
                                                    )}
                                                  </div>
                                                )}
                                              </article>
                                            );
                                          })}
                                      </div>
                                    )}
                                  </section>
                                </div>
                              </details>
                            ))}
                          </div>
                        )}
                      </section>
                    </>
                  ) : (
                    <div className="dashboard-empty-state report-start-state">
                      <strong>Select a report scope</strong>
                      <p>
                        Choose individuals, groups, or leave everything empty
                        for the whole organization, then run the report.
                      </p>
                    </div>
                  )}
                </>
              )}
            </section>
          ) : null}

          {activeView === "knowledge" ? (
            <OrganizationKnowledge
              organizationId={organizationId}
              role={role}
            />
          ) : null}

          {activeView === "settings" ? (
            <section className="dashboard-management-section">
              <div className="dashboard-section-heading">
                <div>
                  <p className="eyebrow">Organization controls</p>
                  <h1>Organization Settings</h1>
                  <p>
                    Manage organization details, shared direction, and Group
                    Manager portal access.
                  </p>
                </div>
              </div>

              {isLoadingSettings ? (
                <p className="form-message">Loading organization settings...</p>
              ) : (
                <div className="user-edit-form">
                  <div className="setup-field">
                    <label htmlFor="settings-organization-name">
                      Organization name
                    </label>

                    <input
                      id="settings-organization-name"
                      type="text"
                      value={settingsOrganizationName}
                      disabled={
                        isSavingSettings || role !== "organization_admin"
                      }
                      onChange={(event) => {
                        setSettingsOrganizationName(event.target.value);
                        setSettingsMessage("");
                      }}
                    />
                  </div>

                  <section className="billing-seat-explanation">
                    <div className="dashboard-section-heading">
                      <div>
                        <p className="eyebrow">Portal AI credits</p>
                        <h2>AI-assisted organization foundation</h2>
                        <p>
                          Generate editable Mission, Vision, and Values
                          suggestions using the organization’s separate portal
                          AI credit pool.
                        </p>
                      </div>
                    </div>

                    {isLoadingOrganizationPortalCredits ? (
                      <p className="form-message">
                        Loading portal AI credits...
                      </p>
                    ) : organizationPortalCreditMessage ? (
                      <p className="form-message" role="alert">
                        {organizationPortalCreditMessage}
                      </p>
                    ) : organizationPortalCreditSummary ? (
                      <div className="usage-metric-grid">
                        <article className="usage-metric-card">
                          <span>Portal AI credits available</span>
                          <strong>
                            {
                              organizationPortalCreditSummary.portal_credits_available
                            }
                          </strong>
                          <small>Separate from employee app credits</small>
                        </article>

                        <article className="usage-metric-card">
                          <span>Portal AI credits used</span>
                          <strong>
                            {
                              organizationPortalCreditSummary.portal_credits_used
                            }
                          </strong>
                          <small>Current billing period</small>
                        </article>

                        <article className="usage-metric-card">
                          <span>Renewal date</span>
                          <strong>
                            {formatReportDate(
                              organizationPortalCreditSummary.portal_credit_renewal_date,
                            )}
                          </strong>
                          <small>Portal pool resets</small>
                        </article>
                      </div>
                    ) : null}

                    {role === "organization_admin" ? (
                      <>
                        <div className="billing-availability-notice">
                          <strong>
                            Generate with AI — uses 1 portal AI credit
                          </strong>
                          <p>
                            Answer the guided questions below. Generated
                            statements remain editable and are not saved until
                            you select Save organization settings.
                          </p>
                        </div>

                        <div className="setup-field">
                          <label htmlFor="mvv-organization-purpose">
                            Why does the organization exist?
                          </label>

                          <textarea
                            id="mvv-organization-purpose"
                            value={mvvOrganizationPurpose}
                            rows={4}
                            disabled={isGeneratingMvv || isSavingSettings}
                            placeholder="Describe the organization’s purpose and the problem it exists to address."
                            onChange={(event) => {
                              setMvvOrganizationPurpose(event.target.value);
                              setMvvGenerationMessage("");
                            }}
                          />
                        </div>

                        <div className="setup-field">
                          <label htmlFor="mvv-customers-served">
                            Who does the organization serve?
                          </label>

                          <textarea
                            id="mvv-customers-served"
                            value={mvvCustomersServed}
                            rows={4}
                            disabled={isGeneratingMvv || isSavingSettings}
                            placeholder="Describe the customers, clients, members, communities, or other people served."
                            onChange={(event) => {
                              setMvvCustomersServed(event.target.value);
                              setMvvGenerationMessage("");
                            }}
                          />
                        </div>

                        <div className="setup-field">
                          <label htmlFor="mvv-products-services">
                            What does the organization provide?
                          </label>

                          <textarea
                            id="mvv-products-services"
                            value={mvvProductsOrServices}
                            rows={4}
                            disabled={isGeneratingMvv || isSavingSettings}
                            placeholder="Describe the products, services, programs, or support the organization provides."
                            onChange={(event) => {
                              setMvvProductsOrServices(event.target.value);
                              setMvvGenerationMessage("");
                            }}
                          />
                        </div>

                        <div className="setup-field">
                          <label htmlFor="mvv-future-direction">
                            What future is the organization working toward?
                          </label>

                          <textarea
                            id="mvv-future-direction"
                            value={mvvFutureDirection}
                            rows={4}
                            disabled={isGeneratingMvv || isSavingSettings}
                            placeholder="Describe what meaningful long-term success should look like."
                            onChange={(event) => {
                              setMvvFutureDirection(event.target.value);
                              setMvvGenerationMessage("");
                            }}
                          />
                        </div>

                        <div className="setup-field">
                          <label htmlFor="mvv-operating-principles">
                            What principles should guide the organization?
                          </label>

                          <textarea
                            id="mvv-operating-principles"
                            value={mvvOperatingPrinciples}
                            rows={4}
                            disabled={isGeneratingMvv || isSavingSettings}
                            placeholder="Describe the behaviors, standards, and principles that should guide decisions."
                            onChange={(event) => {
                              setMvvOperatingPrinciples(event.target.value);
                              setMvvGenerationMessage("");
                            }}
                          />
                        </div>

                        <div className="user-edit-actions">
                          <button
                            className="primary-button"
                            type="button"
                            disabled={
                              isGeneratingMvv ||
                              isSavingSettings ||
                              !organizationPortalCreditSummary ||
                              organizationPortalCreditSummary.portal_credits_available <
                                1
                            }
                            onClick={() => {
                              void handleGenerateOrganizationMvv();
                            }}
                          >
                            {isGeneratingMvv
                              ? "Generating suggestions..."
                              : "Generate Mission, Vision, and Values"}
                          </button>
                        </div>

                        {mvvGenerationMessage ? (
                          <p className="form-message" role="status">
                            {mvvGenerationMessage}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </section>

                  <div className="setup-field">
                    <label htmlFor="settings-mission-statement">
                      Mission statement
                    </label>

                    <textarea
                      id="settings-mission-statement"
                      value={settingsMissionStatement}
                      disabled={
                        isSavingSettings || role !== "organization_admin"
                      }
                      rows={4}
                      placeholder="Describe why the organization exists and what it works to accomplish."
                      onChange={(event) => {
                        setSettingsMissionStatement(event.target.value);
                        setSettingsMessage("");
                      }}
                    />
                  </div>

                  <div className="setup-field">
                    <label htmlFor="settings-vision-statement">
                      Vision statement
                    </label>

                    <textarea
                      id="settings-vision-statement"
                      value={settingsVisionStatement}
                      disabled={
                        isSavingSettings || role !== "organization_admin"
                      }
                      rows={4}
                      placeholder="Describe the future the organization is working toward."
                      onChange={(event) => {
                        setSettingsVisionStatement(event.target.value);
                        setSettingsMessage("");
                      }}
                    />
                  </div>

                  <div className="setup-field">
                    <label htmlFor="settings-values-statement">Values</label>

                    <textarea
                      id="settings-values-statement"
                      value={settingsValuesStatement}
                      disabled={
                        isSavingSettings || role !== "organization_admin"
                      }
                      rows={4}
                      placeholder="Describe the principles that guide decisions and behavior."
                      onChange={(event) => {
                        setSettingsValuesStatement(event.target.value);
                        setSettingsMessage("");
                      }}
                    />
                  </div>

                  <section className="billing-seat-explanation">
                    <div className="dashboard-section-heading">
                      <div>
                        <p className="eyebrow">Manager permissions</p>
                        <h2>Group Manager portal access</h2>
                        <p>
                          Control how far Group Managers can see beyond their
                          assigned primary group.
                        </p>
                      </div>
                    </div>

                    <div className="setup-field">
                      <label htmlFor="settings-manager-access-mode">
                        Manager access scope
                      </label>

                      <select
                        id="settings-manager-access-mode"
                        value={settingsManagerPortalAccessMode}
                        disabled={
                          isSavingSettings || role !== "organization_admin"
                        }
                        onChange={(event) => {
                          setSettingsManagerPortalAccessMode(
                            event.target.value,
                          );
                          setSettingsMessage("");
                        }}
                      >
                        <option value="disabled">Disabled</option>

                        <option value="all_group_managers">
                          Enable all Group Managers
                        </option>

                        <option value="individual">
                          Enable selected Group Managers only
                        </option>
                      </select>

                      <p className="setup-help">
                        Individual Group Managers must also have Manager portal
                        access enabled on their user account.
                      </p>
                    </div>
                  </section>

                  {role === "organization_admin" ? (
                    <div className="user-edit-actions">
                      <button
                        className="primary-button"
                        type="button"
                        disabled={
                          isSavingSettings || !settingsOrganizationName.trim()
                        }
                        onClick={() => {
                          void handleSaveOrganizationSettings();
                        }}
                      >
                        {isSavingSettings
                          ? "Saving settings..."
                          : "Save organization settings"}
                      </button>

                      <button
                        className="text-button"
                        type="button"
                        disabled={isSavingSettings}
                        onClick={() => {
                          void loadOrganizationSettings();
                        }}
                      >
                        Reset unsaved changes
                      </button>
                    </div>
                  ) : (
                    <div className="billing-availability-notice">
                      <strong>View-only settings access</strong>
                      <p>
                        Only an Organization Admin can change these organization
                        settings.
                      </p>
                    </div>
                  )}

                  {settingsMessage ? (
                    <p className="form-message" role="status">
                      {settingsMessage}
                    </p>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default OrganizationDashboard;
