import ModuleCrud from './ModuleCrud';

export default function Designations() {
  return (
    <ModuleCrud
      collection="designations"
      title="Designations"
      subtitle="Create and manage designations used in Employee form, User Control, reporting hierarchy, and Reporting Officer filtering."
      fieldLabels={{
        name: 'Designation Name',
        title: 'Designation Title',
        designation_name: 'Designation Name',
        department: 'Department',
        status: 'Status',
      }}
      hiddenFields={['tenant_id']}
      requiredFields={['name']}
      defaultValues={{
        name: '',
        title: '',
        designation_name: '',
        department: '',
        status: 'active',
      }}
    />
  );
}