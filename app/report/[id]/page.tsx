export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <h1 className="text-2xl font-bold">Report</h1>
      <p className="mt-2 font-mono text-sm text-neutral-500">{id}</p>
    </>
  );
}
