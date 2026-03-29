import Swal from 'sweetalert2'
import 'sweetalert2/dist/sweetalert2.min.css'

export function showAlert(message: string, title = '提示') {
  return Swal.fire({
    title,
    text: message,
    icon: 'info',
    confirmButtonText: '確定',
  })
}

export function showError(message: string, title = '錯誤') {
  return Swal.fire({
    title,
    text: message,
    icon: 'error',
    confirmButtonText: '確定',
  })
}

export function showWarning(message: string, title = '注意') {
  return Swal.fire({
    title,
    text: message,
    icon: 'warning',
    confirmButtonText: '確定',
  })
}

export { Swal }
