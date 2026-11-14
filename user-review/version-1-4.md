Trong tool image2pdf khi mà tôi thêm tầm 120mb ảnh thì việc scroll bát đầu trở nên hơi laggy
Trong tool image2pdf bổ sung thêm option có thể đóng, mở phần Cây mục lục PDF (để chừa nhiều space hơn cho việc xem và kéo thả ảnh)
Trong tool md to pdf, preview và export không có nhận diện đươc checkbox. VD:
````text

### **Definition of Done (DoD)**

* [ ] Dữ liệu sinh viên FIT HCMUS được nạp đầy đủ vào Vector DB (Qdrant).  
* [ ] 100% câu hỏi về biểu mẫu trả về đúng Direct URL từ portal khoa FIT.  
* [ ] Ticket hiển thị đầy đủ thông tin sinh viên, lớp, cảnh báo nếu gửi nhầm giảng viên.  
* [ ] Bộ đếm SLA và highlight quá hạn (>4h, >24h) hoạt động chính xác trên giao diện quản lý.  
      
````
vẫn không hiển thị checkbox mà vẫn hiển thị [ ]
- Trong tool md to pdf vẫn chưa có thể convert code mermaid.
- Trong tool md to pdf, bổ sung thêm chọn theme cho biểu đồ mermaid đó
- Trong tool md to pdf, bổ sung thêm ctrl + F sẽ có thể tìm nội dung trong cả editor và preview. 
- Trong tool md to pdf, bổ sung thêm khi mà tô đen (chọn text) -> nhấn chuột phải -> có option goto vị trí mà text đó dược render trong phần editor
- Trong tool md to pdf, khi mà có section kiểu như là "```text some randome text ```" thì hiện tại tôi chỉ thấy phần text được tô, tôi kỳ vọn toàn bộ section đó sẽ được tô
- Trong tool md to pdf, khi mà tôi convert /home/khoa/Downloads/2026.HW03.md thì nhận được lỗi này: "Dữ liệu đầu vào không hợp lệ: Loi bien dich Typst: emph does not have field "zip""
- Trong tool md to pdf, các unicode như là "📋" vẫn chưa thể preview và convert được.
- Trong tool image2pdf, khi double click và bức ảnh thì sẽ hiện ra cái modal to bự của bức ảnh đó. 
- Trong tool image2pdf, khi triple click thì sẽ hiện ra cái modal edit ảnh 
- Trong tool image2pdf, cái modal edit ảnh phóng to nó ra hơn tý đi
- Trong tool image2pdf, chuyển từ HTML5 draggable sang Pointer Events (onPointerDown / window.pointermove / window.pointerup) (hoặc dùng @dnd-kit/core), kết hợp bỏ duration-150. (Do hiện tại tốc độ sắp xếp ảnh chậm và khá lag).