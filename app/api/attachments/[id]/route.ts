import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { attachmentResponseHeaders } from "@/lib/attachments";
import { tenantAccessFor } from "@/lib/tenant-access";

/**
 * Serve an attachment (#215) to signed-in users. Files on a deleted issue
 * are admin-only (like the issue); files not yet linked to anything are only
 * visible to the person who uploaded them.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();

  const attachment = await prisma.attachment.findUnique({
    where: { id },
    select: {
      uploaderId: true,
      filename: true,
      contentType: true,
      size: true,
      data: true,
      bug: { select: { isDeleted: true, tenantId: true } },
      redesignProposal: { select: { tenantId: true } },
    },
  });

  const notFound = () => NextResponse.json({ error: "File not found" }, { status: 404 });
  if (!attachment) return notFound();
  if (!attachment.bug && !attachment.redesignProposal && attachment.uploaderId !== user.id) return notFound();
  if (attachment.redesignProposal) {
    const membership = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: attachment.redesignProposal.tenantId, userId: user.id } },
      select: { userId: true },
    });
    if (!membership) return notFound();
  }
  if (attachment.bug) {
    const membership = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: attachment.bug.tenantId, userId: user.id } },
      select: { userId: true },
    });
    if (!membership) return notFound();
  }
  if (attachment.bug?.isDeleted) {
    const access = await tenantAccessFor(user.id, attachment.bug.tenantId, user.role);
    if (!access.admin) return notFound();
  }

  return new NextResponse(new Uint8Array(attachment.data), {
    status: 200,
    headers: attachmentResponseHeaders(attachment),
  });
}

/**
 * Delete an attachment (#658, #564).
 * Allowed for the uploader (e.g. form abandoned or user removed file) while
 * they still belong to the workspace that holds it, or an admin of the tenant
 * where the parent issue/comment/proposal lives.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();

  const attachment = await prisma.attachment.findUnique({
    where: { id },
    select: {
      id: true,
      uploaderId: true,
      bugId: true,
      commentId: true,
      redesignProposalId: true,
      bug: { select: { tenantId: true } },
      comment: { select: { bug: { select: { tenantId: true } } } },
      redesignProposal: { select: { tenantId: true } },
    },
  });

  if (!attachment) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const parentTenantId =
    attachment.bug?.tenantId ??
    attachment.comment?.bug?.tenantId ??
    attachment.redesignProposal?.tenantId ??
    null;

  let allowed = false;

  if (attachment.uploaderId === user.id) {
    // An unattached upload is nobody else's business, so its uploader may
    // always drop it. Once it hangs off an issue, comment or proposal it
    // belongs to that workspace as well: a member who has since been removed
    // must not be able to destroy evidence they can no longer read (#564).
    if (!parentTenantId) {
      allowed = true;
    } else {
      const membership = await prisma.membership.findUnique({
        where: { tenantId_userId: { tenantId: parentTenantId, userId: user.id } },
        select: { userId: true },
      });
      allowed = Boolean(membership);
    }
  }

  if (!allowed && parentTenantId) {
    const access = await tenantAccessFor(user.id, parentTenantId, user.role);
    allowed = access.admin;
  }

  if (!allowed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  await prisma.attachment.delete({
    where: { id },
  });

  return NextResponse.json({ success: true }, { status: 200 });
}

