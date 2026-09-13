/** @rfc RFC-13 R3 */
export function NoPermission() {
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      You do not have permission to open this area.
    </p>
  );
}
