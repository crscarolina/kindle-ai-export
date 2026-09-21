import KindleExportCore
import SwiftUI

struct ContentView: View {
  @Bindable var model: AppModel

  var body: some View {
    NavigationSplitView {
      QueueSidebar(model: model)
        .navigationSplitViewColumnWidth(min: 220, ideal: 260)
    } detail: {
      VStack(spacing: 0) {
        if model.needsSignIn {
          SignInBanner(model: model)
        }

        HSplitView {
          LibraryGrid(model: model)
            .frame(minWidth: 420)
          BookDetail(model: model)
            .frame(minWidth: 320, maxWidth: 420)
        }

        Divider()
        LogDrawer(model: model)
          .frame(height: 160)
      }
    }
    .toolbar {
      ToolbarItem(placement: .principal) {
        TextField("Search library", text: $model.search)
          .textFieldStyle(.roundedBorder)
          .frame(width: 240)
      }
      ToolbarItem {
        Button {
          Task { await model.refreshLibrary() }
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }
        .disabled(model.isBusy)
      }
    }
    .overlay(alignment: .bottom) {
      if let status = model.status {
        Text(status)
          .font(.callout)
          .padding(.horizontal, 12)
          .padding(.vertical, 6)
          .background(.thinMaterial, in: Capsule())
          .padding(.bottom, 12)
      }
    }
  }
}

/// Amazon's session has lapsed. The pipeline can't answer a 2FA prompt, so the
/// queue pauses here rather than failing every remaining book.
struct SignInBanner: View {
  @Bindable var model: AppModel

  var body: some View {
    HStack {
      Image(systemName: "exclamationmark.triangle.fill")
        .foregroundStyle(.orange)
      Text("Amazon session expired — the queue is paused.")
      Spacer()
      Button("Sign In") { Task { await model.signIn() } }
        .disabled(model.isBusy)
    }
    .padding(10)
    .background(.orange.opacity(0.12))
  }
}

struct LibraryGrid: View {
  @Bindable var model: AppModel

  private let columns = [GridItem(.adaptive(minimum: 130), spacing: 16)]

  var body: some View {
    ScrollView {
      if model.filteredLibrary.isEmpty {
        ContentUnavailableView(
          "No books",
          systemImage: "books.vertical",
          description: Text("Refresh to load your Kindle library."))
          .padding(.top, 60)
      } else {
        LazyVGrid(columns: columns, spacing: 18) {
          ForEach(model.filteredLibrary) { item in
            BookCell(item: item, isSelected: item.asin == model.selectedAsin)
              .onTapGesture { model.selectedAsin = item.asin }
          }
        }
        .padding(16)
      }
    }
  }
}

struct BookCell: View {
  let item: Book
  let isSelected: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      ZStack {
        RoundedRectangle(cornerRadius: 6).fill(.quaternary)
        if let cover = item.coverUrl, let url = URL(string: cover) {
          AsyncImage(url: url) { image in
            image.resizable().aspectRatio(contentMode: .fit)
          } placeholder: {
            ProgressView().controlSize(.small)
          }
        }
      }
      .frame(height: 180)
      .clipShape(RoundedRectangle(cornerRadius: 6))
      .overlay {
        RoundedRectangle(cornerRadius: 6)
          .strokeBorder(isSelected ? Color.accentColor : .clear, lineWidth: 3)
      }

      Text(item.title).font(.caption).lineLimit(2)
      Text(item.authorLine)
        .font(.caption2)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
  }
}
