import ModuleCrud from './ModuleCrud';

export default function Departments() {
  return (
    <ModuleCrud
      collection="departments"
      title="Departments"
      subtitle="Create and manage departments used in Employee form, employee filtering, reports, attendance, leave, and project records."
      fieldLabels={{
        name: 'Department Name',
        department_name: 'Department Name',
        code: 'Department Code',
        status: 'Status',
      }}
      hiddenFields={['tenant_id']}
      requiredFields={['name']}
      defaultValues={{
        name: '',
        department_name: '',
        code: '',
        status: 'active',
      }}
    />
  );
}