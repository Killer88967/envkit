export type DoctorCheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  status: DoctorCheckStatus;
  message: string;
}
