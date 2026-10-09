export interface ProjectUploadMember {
  user_id: string;
}

/** A project member may upload; a missing project produces no members and is denied. */
export async function canUploadDocumentToProject(
  projectId: string,
  userId: string,
  getProjectMembers: (projectId: string) => Promise<ProjectUploadMember[]>,
): Promise<boolean> {
  if (!projectId.trim() || !userId.trim()) return false;
  const members = await getProjectMembers(projectId);
  return members.some((member) => member.user_id === userId);
}
