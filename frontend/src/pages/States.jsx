import ModuleCrud from './ModuleCrud';

export default function States() {
  return (
    <ModuleCrud
      collection="states"
      title="States"
      subtitle="Create and manage operating states used in Employee form, attendance, and holiday calendar."
      fieldLabels={{
        name: 'State Name',
        state_name: 'State Name',
        code: 'State Code',
        status: 'Status',
      }}
      hiddenFields={['tenant_id']}
      requiredFields={['name']}
      defaultValues={{
        name: '',
        state_name: '',
        code: '',
        status: 'active',
      }}
    />
  );
}