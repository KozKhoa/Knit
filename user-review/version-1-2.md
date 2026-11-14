- Trong tool conver md to pdf thì hiện tại đang bị lỗi ở khi tiến hành convert:
	````text
	  ---
		name: requirements-analysis
		description: Diagnose requirements problems and guide discovery of real needs and constraints
		license: MIT
		metadata:
		  author: jwynia
		  version: "1.0"
		  domain: agile-software
		  cluster: software
		  type: diagnostic
		  mode: assistive
		---
	````
	sang pdf, không thể hiển thị đầy đủ rõ ràng ra thành table như là md viewer trên vscode hay là obsidian mà chỉ hiện ra thuần text nằm ngang
- Thanh bên trái hiện còn đang thừa phần thay đổi ngôn ngữ, hiện tại thì cái đó cở trong setting page rồi
- Đối với tool MD/TXT/HTML/EPUB to pdf thì hiển thị preview dùng: **`pdfjs-dist`** đi.
- Trong phần setting chỉnh "KÍCH THƯỚC CHỮ ỨNG DỤNG" thì đối với thanh kéo thay đổi chữ thì nếu như người dùng vẫn còn hold chuột lên thanh kéo thì chưa áp dụng thay đổi
- Viết một component `<Select>` custom dùng chung (hoặc dùng Radix UI Select) để kiểm soát hoàn toàn popup menu, hover, checkmark, keyboard navigation (lên/xuống/Enter/Esc) và font chữ bên trong danh sách
- Trong tool md to pdf thì chiều dài của phần edit và preview có thể thay đổi, kéo thả và lưu chiều cao kéo thả đó lại đi
- 