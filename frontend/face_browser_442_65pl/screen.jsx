
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import AttendanceWidget from '/src/components/AttendanceWidget.jsx';
import CustomAlertProvider from '/src/components/CustomAlertProvider.jsx';
import {FaceAccess} from '/src/components/FaceAccess.jsx';
import FaceManagement from '/src/pages/FaceManagement.jsx';
import FaceAttendanceSettings from '/src/components/FaceAttendanceSettings.jsx';
function App() {
  const [page, setPage] = useState('attendance');
  return <CustomAlertProvider>{page === 'face_attendance'
    ? <FaceManagement setPage={setPage}/>
    : <><FaceAttendanceSettings confirmChange={async () => true} onOpenEnrollment={() => setPage('face_attendance')}/><FaceAccess setPage={setPage}/><AttendanceWidget/></>}</CustomAlertProvider>;
}
createRoot(document.getElementById('root')).render(<App/>);
