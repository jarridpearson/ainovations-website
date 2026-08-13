import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabase";

type OrganizationGroup = {
  id: string;
  organization_id: string;
  name: string;
  slug: string | null;
  parent_group_id: string | null;
  description: string | null;
  is_active: boolean;
};

type DisplayGroup = OrganizationGroup & {
  depth: number;
};

type OrganizationDirectoryUser = {
  primary_group_id: string | null;
  is_active: boolean;
};

type OrganizationGroupManagerProps = {
  organizationId: string;
  onGroupsChanged?: () => Promise<void> | void;
};

type GroupErrors = {
  groupName?: string;
};

function getDescendantIds(
  groups: OrganizationGroup[],
  groupId: string,
) {
  const descendantIds = new Set<string>();
  const pendingGroupIds = [groupId];

  while (pendingGroupIds.length > 0) {
    const currentGroupId = pendingGroupIds.shift();

    groups
      .filter(
        (group) =>
          group.parent_group_id === currentGroupId,
      )
      .forEach((childGroup) => {
        if (!descendantIds.has(childGroup.id)) {
          descendantIds.add(childGroup.id);
          pendingGroupIds.push(childGroup.id);
        }
      });
  }

  return descendantIds;
}

export default function OrganizationGroupManager({
  organizationId,
  onGroupsChanged,
}: OrganizationGroupManagerProps) {
  const [groups, setGroups] = useState<
    OrganizationGroup[]
  >([]);

  const [organizationUsers, setOrganizationUsers] =
    useState<OrganizationDirectoryUser[]>([]);

  const [selectedGroupId, setSelectedGroupId] =
    useState("");

  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] =
    useState("");
  const [parentGroupId, setParentGroupId] =
    useState("");

  const [groupErrors, setGroupErrors] =
    useState<GroupErrors>({});

  const [groupMessage, setGroupMessage] =
    useState("");

  const [isLoadingGroups, setIsLoadingGroups] =
    useState(true);

  const [isSavingGroup, setIsSavingGroup] =
    useState(false);

  const [deactivatingGroupId, setDeactivatingGroupId] =
    useState("");

  const selectedGroup =
    groups.find(
      (group) => group.id === selectedGroupId,
    ) ?? null;

  const loadGroups = useCallback(async () => {
    setIsLoadingGroups(true);

    const [groupsResult, usersResult] =
      await Promise.all([
        supabase
          .from("organization_groups")
          .select(
            `
              id,
              organization_id,
              name,
              slug,
              parent_group_id,
              description,
              is_active
            `,
          )
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("name"),

        supabase.rpc(
          "get_organization_user_directory",
          {
            p_organization_id: organizationId,
          },
        ),
      ]);

    if (groupsResult.error) {
      console.error(
        "Organization groups failed to load:",
        groupsResult.error,
      );

      setGroupMessage(
        "Unable to load organization groups.",
      );

      setIsLoadingGroups(false);
      return;
    }

    if (usersResult.error) {
      console.error(
        "Organization users failed to load:",
        usersResult.error,
      );

      setGroupMessage(
        "Unable to load organization users.",
      );

      setIsLoadingGroups(false);
      return;
    }

    setGroups(
      (groupsResult.data ?? []) as OrganizationGroup[],
    );

    setOrganizationUsers(
      (usersResult.data ?? []).map(
        (user: Record<string, unknown>) => ({
          primary_group_id:
            typeof user.primary_group_id === "string"
              ? user.primary_group_id
              : null,

          is_active: user.is_active === true,
        }),
      ),
    );

    setIsLoadingGroups(false);
  }, [organizationId]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const displayGroups = useMemo(() => {
    const activeGroups = groups.filter(
      (group) => group.is_active,
    );

    const groupsByParent = new Map<
      string | null,
      OrganizationGroup[]
    >();

    activeGroups.forEach((group) => {
      const parentKey =
        group.parent_group_id ?? null;

      const existingGroups =
        groupsByParent.get(parentKey) ?? [];

      existingGroups.push(group);

      groupsByParent.set(
        parentKey,
        existingGroups,
      );
    });

    groupsByParent.forEach((groupList) => {
      groupList.sort((first, second) =>
        first.name.localeCompare(second.name),
      );
    });

    const flattenedGroups: DisplayGroup[] = [];
    const visitedGroupIds = new Set<string>();

    function addGroupAndChildren(
      group: OrganizationGroup,
      depth: number,
    ) {
      if (visitedGroupIds.has(group.id)) {
        return;
      }

      visitedGroupIds.add(group.id);

      flattenedGroups.push({
        ...group,
        depth,
      });

      const children =
        groupsByParent.get(group.id) ?? [];

      children.forEach((child) => {
        addGroupAndChildren(
          child,
          depth + 1,
        );
      });
    }

    const rootGroups =
      groupsByParent.get(null) ?? [];

    rootGroups.forEach((group) => {
      addGroupAndChildren(group, 0);
    });

    activeGroups.forEach((group) => {
      if (!visitedGroupIds.has(group.id)) {
        addGroupAndChildren(group, 0);
      }
    });

    return flattenedGroups;
  }, [groups]);

  const unavailableParentIds = selectedGroupId
    ? getDescendantIds(
        groups,
        selectedGroupId,
      )
    : new Set<string>();

  function resetGroupForm() {
    setSelectedGroupId("");
    setGroupName("");
    setGroupDescription("");
    setParentGroupId("");
    setGroupErrors({});
  }

  function beginEditingGroup(
    group: OrganizationGroup,
  ) {
    setSelectedGroupId(group.id);
    setGroupName(group.name);
    setGroupDescription(
      group.description ?? "",
    );
    setParentGroupId(
      group.parent_group_id ?? "",
    );
    setGroupErrors({});
    setGroupMessage("");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function handleSaveGroup(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const normalizedName =
      groupName.trim();

    const normalizedDescription =
      groupDescription.trim();

    const nextErrors: GroupErrors = {};

    if (!normalizedName) {
      nextErrors.groupName =
        "Enter a group name.";
    }

    setGroupErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setGroupMessage(
        "Enter the required group information.",
      );

      return;
    }

    setIsSavingGroup(true);

    setGroupMessage(
      selectedGroup
        ? "Saving group changes..."
        : "Creating group...",
    );

    const result = selectedGroup
      ? await supabase.rpc(
          "update_managed_organization_group",
          {
            p_organization_id:
              organizationId,

            p_group_id:
              selectedGroup.id,

            p_name:
              normalizedName,

            p_parent_group_id:
              parentGroupId || null,

            p_description:
              normalizedDescription || null,
          },
        )
      : await supabase.rpc(
          "create_managed_organization_group",
          {
            p_organization_id:
              organizationId,

            p_name:
              normalizedName,

            p_parent_group_id:
              parentGroupId || null,

            p_description:
              normalizedDescription || null,
          },
        );

    if (result.error) {
      console.error(
        "Organization group save failed:",
        result.error,
      );

      setGroupMessage(
        result.error.message ||
          "Unable to save the group.",
      );

      setIsSavingGroup(false);
      return;
    }

    const completedMessage = selectedGroup
      ? `${normalizedName} was updated successfully.`
      : `${normalizedName} was added successfully.`;

    resetGroupForm();

    await loadGroups();
    await onGroupsChanged?.();

    setGroupMessage(completedMessage);
    setIsSavingGroup(false);
  }

  async function handleDeactivateGroup(
    group: OrganizationGroup,
  ) {
    const childGroupCount = groups.filter(
      (candidate) =>
        candidate.parent_group_id === group.id,
    ).length;

    const activeUserCount =
      organizationUsers.filter(
        (user) =>
          user.is_active &&
          user.primary_group_id === group.id,
      ).length;

    if (childGroupCount > 0) {
      setGroupMessage(
        "Move or deactivate this group’s child groups first.",
      );

      return;
    }

    if (activeUserCount > 0) {
      setGroupMessage(
        "Move active users out of this group before deactivating it.",
      );

      return;
    }

    const confirmed = window.confirm(
      `Deactivate "${group.name}"?`,
    );

    if (!confirmed) {
      return;
    }

    setDeactivatingGroupId(group.id);
    setGroupMessage(
      `Deactivating ${group.name}...`,
    );

    const { error } = await supabase.rpc(
      "deactivate_managed_organization_group",
      {
        p_organization_id:
          organizationId,

        p_group_id:
          group.id,
      },
    );

    if (error) {
      console.error(
        "Organization group deactivation failed:",
        error,
      );

      setGroupMessage(
        error.message ||
          "Unable to deactivate the group.",
      );

      setDeactivatingGroupId("");
      return;
    }

    if (selectedGroupId === group.id) {
      resetGroupForm();
    }

    await loadGroups();
    await onGroupsChanged?.();

    setGroupMessage(
      `${group.name} was deactivated successfully.`,
    );

    setDeactivatingGroupId("");
  }

  if (isLoadingGroups) {
    return (
      <p className="form-message">
        Loading organization groups...
      </p>
    );
  }

  return (
    <section className="organization-setup organization-group-management">
      <div className="setup-heading">
        <p className="eyebrow">
          Organization structure
        </p>

        <h1>Manage your organization structure.</h1>

        <p>
          Add departments, teams, locations, or other
          management groups. Edit existing groups or
          change where they sit in the hierarchy.
        </p>
      </div>

      <div className="setup-form">
        <section className="setup-section">
          <div className="setup-section-heading">
            <span className="setup-step-number">
              1
            </span>

            <div>
              <h2>
                {selectedGroup
                  ? "Edit group"
                  : "Create groups"}
              </h2>

              <p>
                Begin with top-level groups, then place
                teams or departments beneath them as
                needed.
              </p>
            </div>
          </div>

          <form
            className="group-creation-form"
            onSubmit={handleSaveGroup}
            noValidate
          >
            <div className="setup-field">
              <label htmlFor="managed-group-name">
                Group name
              </label>

              <input
                id="managed-group-name"
                name="groupName"
                type="text"
                placeholder="Example: Sales"
                value={groupName}
                disabled={
                  isSavingGroup ||
                  Boolean(deactivatingGroupId)
                }
                aria-invalid={Boolean(
                  groupErrors.groupName,
                )}
                aria-describedby={
                  groupErrors.groupName
                    ? "managed-group-name-error"
                    : undefined
                }
                onChange={(event) => {
                  setGroupName(
                    event.target.value,
                  );

                  setGroupErrors(
                    (current) => ({
                      ...current,
                      groupName: undefined,
                    }),
                  );

                  setGroupMessage("");
                }}
              />

              {groupErrors.groupName ? (
                <p
                  id="managed-group-name-error"
                  className="field-error"
                >
                  {groupErrors.groupName}
                </p>
              ) : null}
            </div>

            <div className="setup-field">
              <label htmlFor="managed-parent-group">
                Parent group
              </label>

              <select
                id="managed-parent-group"
                name="parentGroup"
                value={parentGroupId}
                disabled={
                  isSavingGroup ||
                  Boolean(deactivatingGroupId)
                }
                onChange={(event) => {
                  setParentGroupId(
                    event.target.value,
                  );

                  setGroupMessage("");
                }}
              >
                <option value="">
                  No parent — top-level group
                </option>

                {displayGroups
                  .filter(
                    (group) =>
                      group.id !==
                        selectedGroupId &&
                      !unavailableParentIds.has(
                        group.id,
                      ),
                  )
                  .map((group) => (
                    <option
                      key={group.id}
                      value={group.id}
                    >
                      {`${"— ".repeat(
                        group.depth,
                      )}${group.name}`}
                    </option>
                  ))}
              </select>

              <p className="setup-help">
                Select a parent only when this group
                reports beneath another group.
              </p>
            </div>

            <div className="setup-field">
              <label htmlFor="managed-group-description">
                Description{" "}
                <span className="optional-label">
                  Optional
                </span>
              </label>

              <textarea
                id="managed-group-description"
                name="groupDescription"
                rows={4}
                placeholder="Describe the purpose or responsibility of this group."
                value={groupDescription}
                disabled={
                  isSavingGroup ||
                  Boolean(deactivatingGroupId)
                }
                onChange={(event) => {
                  setGroupDescription(
                    event.target.value,
                  );

                  setGroupMessage("");
                }}
              />
            </div>

            <button
              className="primary-button group-add-button"
              type="submit"
              disabled={
                isSavingGroup ||
                Boolean(deactivatingGroupId)
              }
            >
              {isSavingGroup
                ? "Saving group..."
                : selectedGroup
                  ? "Save group changes"
                  : "Save group"}
            </button>

            {selectedGroup ? (
              <button
                className="text-button setup-back-button"
                type="button"
                disabled={
                  isSavingGroup ||
                  Boolean(deactivatingGroupId)
                }
                onClick={() => {
                  resetGroupForm();
                  setGroupMessage("");
                }}
              >
                Cancel editing
              </button>
            ) : null}
          </form>
        </section>

        <section className="setup-section">
          <div className="setup-section-heading">
            <span className="setup-step-number">
              2
            </span>

            <div>
              <h2>Review group hierarchy</h2>

              <p>
                Select Edit to rename a group or change
                where it sits in the organization.
              </p>
            </div>
          </div>

          {displayGroups.length === 0 ? (
            <div className="groups-empty-state">
              <strong>No groups created yet</strong>

              <p>
                Add the first department, team,
                location, or management group above.
              </p>
            </div>
          ) : (
            <div className="group-hierarchy-list">
              {displayGroups.map((group) => {
                const childGroupCount =
                  groups.filter(
                    (candidate) =>
                      candidate.parent_group_id ===
                      group.id,
                  ).length;

                const activeUserCount =
                  organizationUsers.filter(
                    (user) =>
                      user.is_active &&
                      user.primary_group_id ===
                        group.id,
                  ).length;

                const cannotDeactivate =
                  childGroupCount > 0 ||
                  activeUserCount > 0;

                return (
                  <article
                    key={group.id}
                    className="group-hierarchy-item"
                    style={{
                      marginLeft: `${
                        Math.min(group.depth, 5) *
                        28
                      }px`,
                    }}
                  >
                    <div className="group-hierarchy-marker" />

                    <div className="managed-group-hierarchy-content">
                      <div className="managed-group-hierarchy-copy">
                        <strong>{group.name}</strong>

                        <span>
                          {group.parent_group_id
                            ? `Reports under ${
                                groups.find(
                                  (candidate) =>
                                    candidate.id ===
                                    group.parent_group_id,
                                )?.name ??
                                "another group"
                              }`
                            : "Top-level group"}
                        </span>

                        {group.description ? (
                          <p>{group.description}</p>
                        ) : null}
                      </div>

                      <div className="managed-group-actions">
                        <button
                          className="text-button"
                          type="button"
                          disabled={
                            isSavingGroup ||
                            Boolean(
                              deactivatingGroupId,
                            )
                          }
                          onClick={() => {
                            beginEditingGroup(group);
                          }}
                        >
                          Edit
                        </button>

                        <button
                          className="danger-button"
                          type="button"
                          disabled={
                            isSavingGroup ||
                            Boolean(
                              deactivatingGroupId,
                            ) ||
                            cannotDeactivate
                          }
                          title={
                            childGroupCount > 0
                              ? "Move or deactivate child groups first."
                              : activeUserCount > 0
                                ? "Move active users out of this group first."
                                : undefined
                          }
                          onClick={() => {
                            void handleDeactivateGroup(
                              group,
                            );
                          }}
                        >
                          {deactivatingGroupId ===
                          group.id
                            ? "Deactivating..."
                            : "Deactivate"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="setup-actions">
          {groupMessage ? (
            <p
              className="form-message"
              role="status"
            >
              {groupMessage}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
