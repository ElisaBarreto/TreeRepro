/** @rfc RFC-13 R3 */
export function NoPermission() {
  return (
    <p
      role="alert"
      className="rounded-[10px] border border-red-300 bg-red-50 px-4 py-3 text-cell text-red-800"
    >
      You do not have permission to open this area.
    </p>
  );
}
