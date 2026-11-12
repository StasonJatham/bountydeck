import { OrganizationAdministration } from "../../../components/organization-administration";

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <OrganizationAdministration
      searchParams={searchParams}
      platformOnly={true}
    />
  );
}
